import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { pin } from '../structural';

/**
 * The five footguns in `notes/NOTES.md`, checked against the source text.
 *
 * Every one of them was read out of the playback library's source rather than
 * its documentation, and **every one fails as something else**: silence with no
 * error, a rising voice, a book reading itself aloud through the speaker, a
 * command centre with two owners. None of them throws, none of them appears in a
 * crash report, and three of them are one word each. A test suite that cannot
 * load the native library can still read the lines that obey them — which is the
 * same technique `test/app-config.test.ts` uses for the ADR decisions that live
 * in configuration rather than in code, and for the same reason: nothing else
 * would notice them being undone.
 *
 * What this cannot do is prove the graph works. `test/README.md` is explicit that
 * React Native code and native modules are not tested in this suite by design,
 * and a mock of `react-native-audio-api` would only prove the mock was called.
 * That rests on the 60–90 minute device session of `notes/NOTES.md` item 4.
 */

const directory = new URL('../../src/playback/', import.meta.url).pathname;

const sources = new Map<string, string>(
  readdirSync(directory)
    .filter((name) => name.endsWith('.ts'))
    .map((name) => [name, readFileSync(directory + name, 'utf8')]),
);

/**
 * The code, without the comments.
 *
 * Needed because this directory explains each footgun where it obeys it, so the
 * words `PlaybackNotificationManager` and `AudioContext.currentTime` appear in
 * prose right beside the lines that avoid them. A naive search would find the
 * explanation and call it the offence.
 */
function code(name: string): string {
  const text = sources.get(name);
  if (text === undefined) throw new Error(`src/playback/${name} does not exist`);
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

const everyFile = (): string[] => [...sources.keys()];
const allCode = (): string => everyFile().map(code).join('\n');

/** The named bindings of every import from `react-native-audio-api`, across the directory. */
function audioApiImports(): string[] {
  const names: string[] = [];
  for (const name of everyFile()) {
    for (const match of code(name).matchAll(/import\s+([\s\S]*?)\s+from\s+'react-native-audio-api'/g)) {
      for (const binding of match[1]!.replace(/[{}]/g, '').split(',')) {
        const cleaned = binding.replace(/\btype\b/g, '').trim();
        if (cleaned) names.push(cleaned);
      }
    }
  }
  return names;
}

describe('the comment stripper this file relies on', () => {
  // First, so that a stripper that ate the whole file reports itself as that
  // rather than as five footguns mysteriously obeyed.
  it('keeps code and removes prose', () => {
    const graph = code('audio-graph.ts');
    expect(graph).toContain('createBufferQueueSource');
    // The word appears only in the comment explaining why it is never called.
    expect(sources.get('audio-graph.ts')).toContain('PlaybackNotificationManager');
    expect(graph).not.toContain('PlaybackNotificationManager');
  });
});

describe('footgun 1: the audio session needs iosCategory AND iosMode together', () => {
  it('passes both, with the mode spokenAudio', () => {
    // AudioManager.setAudioSessionOptions substitutes '' for whichever is
    // omitted, '' matches no case in AudioSessionManager.categoryFromString, the
    // category becomes nil, setCategory fails, the session never activates and
    // playback is SILENT WITH NO ERROR. `{ iosMode: 'spokenAudio' }` alone does
    // it. The library's documented warning covers incompatible combinations, not
    // omission.
    const call = /setAudioSessionOptions\(\{([^}]*)\}\)/.exec(code('audio-graph.ts'));
    expect(call, 'nothing in src/playback calls setAudioSessionOptions').not.toBeNull();
    expect(call![1]).toContain('iosCategory');
    expect(call![1]).toContain('iosMode');
    expect(call![1]).toContain("'spokenAudio'");
  });

  it('activates the session explicitly and awaits it, which is what makes the failure reportable', () => {
    // setAudioSessionActivity runs configureAudioSession first and rejects with
    // the native error when it fails. The node's own start() would activate the
    // session too and swallow that.
    expect(code('audio-graph.ts')).toMatch(/await AudioManager\.setAudioSessionActivity\(true\)/);
  });
});

describe('footgun 2: pause on OldDeviceUnavailable, or the book reads itself aloud', () => {
  it('listens for the route change and tests for that reason', () => {
    // SystemNotificationManager.handleRouteChange dispatches the event and then
    // calls handleEngineConfigurationChange, which rebuilds the engine and keeps
    // playing. Nothing else pauses.
    const graph = code('audio-graph.ts');
    expect(graph).toContain("addSystemEventListener('routeChange'");
    expect(graph).toContain("'OldDeviceUnavailable'");
  });

  it('pauses when it fires', () => {
    expect(code('engine.ts')).toMatch(/function onOutputLost\(\): void \{\s*pauseNow\(\);/);
  });
});

describe('footgun 3: a drained queue is safe, so nothing defends against it', () => {
  it('never calls suspend', () => {
    // A stopped engine under an active playback session is what puts the app at
    // risk of being suspended while backgrounded.
    expect(allCode()).not.toMatch(/\.suspend\(/);
  });

  it('stops a source only for an explicit seek or disposal, never starvation', () => {
    const graph = code('audio-graph.ts');
    const stops = [...graph.matchAll(/node\.stop\(/g)];
    expect(stops).toHaveLength(2);
    expect(stops[0]!.index!).toBeGreaterThan(graph.indexOf('clear()'));
    expect(stops[0]!.index!).toBeLessThan(graph.indexOf('async dispose()'));
    expect(stops[1]!.index!).toBeGreaterThan(graph.indexOf('async dispose()'));
    // A replaced source cannot deliver an old position into the new timeline.
    expect(graph).toContain('if (generation !== sourceGeneration) return;');
    expect(code('engine.ts')).toContain('timeline.reset()');
  });

  it('leaves source replacement to the graph on an explicit seek', () => {
    const engine = code('engine.ts');
    expect(engine).not.toMatch(/graph\?\.stop\(/);
    // A seek resets the source; ordinary input starvation does not. New audio
    // starts the replacement through enqueue, without suspending the context.
    expect(engine).toMatch(/seek\(utterance\) \{[\s\S]*?pump\(\);\s*\},/);
  });
});

describe('footgun 4: the library never claims the command centre', () => {
  it('imports no notification manager from the library (ADR 0016)', () => {
    // The library touches MediaPlayer from exactly one file, instantiated lazily
    // on the first show(). If show() is never called there is no contest over
    // either singleton — and it cannot be called without being imported, because
    // it is not a global.
    const imported = audioApiImports();
    expect(imported).not.toContain('PlaybackNotificationManager');
    expect(imported).not.toContain('NotificationManager');
    expect(imported).not.toContain('RecordingNotificationManager');
  });

  it('calls no show() anywhere', () => {
    expect(allCode()).not.toMatch(/\.show\(/);
  });
});

describe('footgun 6: pitchCorrection is opt-in per node', () => {
  it('creates the queue source with it, every time it creates one', () => {
    // Without it playbackRate is a plain resampler and the book is read in a
    // rising voice at 1.5-3x. No error, no API difference: it sounds like a bad
    // Provider or a wrong sample rate. ADR 0009 requires the pitch-preserving
    // stretch and this flag is the whole of it.
    const calls = [...allCode().matchAll(/createBufferQueueSource\(([^)]*)\)/g)];
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) expect(call[1]).toContain('pitchCorrection: true');
  });

  it('clamps the rate to the same ceiling the stretcher does', () => {
    // WsolaTimeStretcher::MAX_PLAYBACK_RATE is 4 and the audio thread clamps to
    // it. A rate above 4 would play at 4 while the timings were divided by the
    // larger number.
    expect(code('rate.ts')).toContain('MAX_PLAYBACK_RATE = 4');
    expect(code('engine.ts')).toMatch(/graph\?\.setRate\(rate\)/);
    // Both clamps, spelled out. `rate = clampRate(` matched the initialiser too,
    // so the one that matters — the owner's new rate, arriving from the stepper —
    // could become `rate = next` with this rule still green: the node would clamp
    // to 4 on the audio thread while `scaleTimings` divided the Word Timings by
    // the larger number, which is drift, and it is the drift this project exists
    // to prevent.
    pin(code('engine.ts'), 'rate = clampRate(next);', 'engine.ts, setRate');
    pin(code('engine.ts'), 'let rate = clampRate(deps.rate ?? NATURAL_PACE);', 'engine.ts, the initialiser');
  });
});

describe('ADR 0012: the clock is the source node’s, never the context’s', () => {
  it('reads currentTime nowhere', () => {
    // AudioContext.currentTime counts rendered frames over the sample rate: a
    // wall clock, not scaled by playback rate. At 1.5-3x, using it reintroduces
    // exactly the drift this module exists to prevent.
    expect(allCode()).not.toMatch(/\.currentTime/);
  });

  it('takes the position from onPositionChanged on the node', () => {
    const graph = code('audio-graph.ts');
    // The handler itself, not any assignment to the property: `dispose()` writes
    // `node.onPositionChanged = null` too, so the pattern was answered by the
    // teardown and the only clock this app has could be unwired with this rule
    // still green — silently, since a node with no position handler raises nothing.
    pin(graph, 'node.onPositionChanged = (event) => {', 'audio-graph.ts');
    pin(graph, 'node.onPositionChangedInterval = POSITION_INTERVAL_MS;', 'audio-graph.ts');
    expect(graph).toContain('handlers.onPosition(event.value)');
  });

  it('sends the correction about once a second, not once a word', () => {
    // ADR 0005: postMessage into a WebView is a script injection and an eval per
    // message, so one per word is the wrong mechanism. The native
    // PositionChangedDispatcher does the throttling, counting rendered frames.
    expect(code('reader-clock.ts')).toContain('POSITION_INTERVAL_MS = 1000');
    expect(code('audio-graph.ts')).toContain('node.onPositionChangedInterval = POSITION_INTERVAL_MS');
  });
});

describe('the directory boundaries', () => {
  it('imports the audio library from one file only, which is what leaves the rest testable', () => {
    const importers = everyFile().filter((name) => code(name).includes("from 'react-native-audio-api'"));
    expect(importers).toEqual(['audio-graph.ts']);
  });

  it('imports nothing from renderer/, which does not exist and must not be depended on', () => {
    // Lint does not constrain the layers above core/. That is deliberate, and it
    // is not permission (src/README.md).
    expect(allCode()).not.toMatch(/from '\.\.\/renderer/);
    expect(allCode()).not.toMatch(/from '\.\.\/now-playing/);
  });

  it('asks no Provider for a speed, because there is no such parameter (ADR 0009)', () => {
    expect(allCode()).not.toMatch(/\bspeed\b\s*:/);
  });
});

describe('footgun 3 again: the engine says when the silence is permanent', () => {
  /**
   * The other half of footgun 3, and the one it took a device run to see. A drained
   * queue renders silence and stays in the playing state — which is right, and which
   * means running out of text and waiting for a Provider look identical from inside
   * the engine. On 2026-09-20 at 04:43 the first of those lasted six minutes with the
   * app reporting `playing=true` and saying nothing.
   */
  const engine = code('engine.ts');

  /** One member of the returned object, from its opening line to the `},` that closes it. */
  const member = (name: string): string => {
    const start = engine.indexOf(name);
    if (start < 0) throw new Error('engine.ts has no ' + name);
    const end = engine.indexOf('\n    },', start);
    if (end < 0) throw new Error('no close after ' + name);
    return engine.slice(start, end);
  };

  it('asks after every pump, which is where a consumed buffer lands', () => {
    // `onBufferEnded` ends in `pump()`, and the last buffer ending is the moment
    // there is nothing left. Asking anywhere else would be asking before the queue
    // was empty or not at all.
    const pump = engine.slice(engine.indexOf('function pump()'), engine.indexOf('function outOfText()'));
    pin(pump, 'outOfText();', 'engine.ts, pump');
    expect(pump.indexOf('void drain();')).toBeLessThan(pump.indexOf('outOfText();'));
    expect(engine).toMatch(/function onBufferEnded\([\s\S]*?pump\(\);\s*\}/);
  });

  it('decides with read-ahead.ts’s four conditions rather than its own', () => {
    pin(engine, 'if (!hasRunOut(state)) return;', 'engine.ts');
    pin(engine, 'deps.onOutOfText?.({ known: utterances.length, unspoken: failed.size, refusal: lastRefusal });', 'engine.ts');
  });

  /**
   * The failures go in the **report**, not in a fifth condition (ADR 0023). A Clip
   * that was refused used to leave `inFlight` while `drain` stepped over it and
   * `nextToEnqueue` passed it, so all four conditions held exactly as they do for a
   * finished book — which is how "That was the last of this document" was said to
   * an owner whose Provider had dropped the last clips (notes/NOTES_2026-09-20.md,
   * 07:48). Since ADR 0027 `drain` stops on a refusal instead, so the report is kept
   * as a guard; without `unspoken` reaching the app there would be nothing to say
   * the third sentence from, and the lie would come back silently.
   */
  it('counts what was never spoken beside the exhaustion, from the set it already keeps', () => {
    // Set where an Utterance is marked failed, both times, and cleared where the set
    // is: a refusal that outlived its own failure would name the wrong thing.
    const startFetch = engine.slice(engine.indexOf('function startFetch('), engine.indexOf('async function drain('));
    pin(startFetch, 'failed.add(index);', 'engine.ts, startFetch');
    pin(startFetch, 'lastRefusal = error;', 'engine.ts, startFetch');
    const drain = engine.slice(engine.indexOf('async function drain('), engine.indexOf('async function enqueue('));
    pin(drain, 'failed.add(nextToEnqueue);', 'engine.ts, drain');
    pin(drain, 'lastRefusal = error;', 'engine.ts, drain');
    // Sliced to `restart` itself rather than through `member`, whose close marker is
    // an object member's and reaches to the end of the returned object.
    const restart = engine.slice(engine.indexOf('function restart('), engine.indexOf('function cancelVoiceSwitch('));
    pin(restart, 'failed.clear();', 'engine.ts, restart');
    pin(restart, 'lastRefusal = null;', 'engine.ts, restart');
    // And a press of Play, which asks again for every refusal (#45): the refusal
    // from before the press goes with them, or the next stop would name it again
    // when the network was already back (notes/NOTES_2026-09-23.md, 13:30).
    const play = member('    play() {');
    pin(play, 'const retry = retryOnPlay({ cursor, nextToEnqueue, failed });', 'engine.ts, play');
    pin(play, 'failed = new Set(retry.failed);', 'engine.ts, play');
    pin(play, 'lastRefusal = null;', 'engine.ts, play');
  });

  it('says it once, and is armed again by anything that gives the engine somewhere to go', () => {
    // Without the guard it would fire on every pump for as long as the silence
    // lasted — a sentence that arrives once is a report, one that arrives forty
    // times a minute is noise nobody reads.
    expect(member('function outOfText()')).toContain('if (announced || disposed) return;');
    expect(member('function restart(')).toContain('announced = false;');
    expect(member('extend(list) {')).toContain('if (list.length > utterances.length) announced = false;');
  });
});

describe('a longer Utterance list restarts nothing (notes/NOTES_2026-09-20.md, 04:43)', () => {
  const engine = code('engine.ts');
  const extend = engine.slice(engine.indexOf('extend(list) {'), engine.indexOf('\n    },', engine.indexOf('extend(list) {')));

  it('slices the member this section is about, and no more', () => {
    expect(extend).toContain('extend(list) {');
    expect(extend).not.toContain('play()');
    expect(extend).not.toContain('load(list, from = 0');
  });

  it('never clears the queue, re-anchors the clock or invalidates a fetch', () => {
    // `load` does all three, and that is why the app used to hold a longer list back
    // until the next Clip boundary — a boundary that is itself a Clip starting, and
    // so one that never comes when the engine has run out. Restarting here would put
    // the deadlock back and restart the sentence being spoken on the way.
    expect(extend).not.toContain('restart(');
    expect(extend).not.toContain('generation++');
    expect(extend).not.toContain('timeline.reset()');
    expect(extend).not.toContain('graph?.clear()');
  });

  it('takes the longer list and lets the read-ahead walk into it', () => {
    expect(extend).toContain('utterances = list;');
    expect(extend).toContain('pump();');
  });

  it('leaves load destructive, because the renumbering case needs it to be', () => {
    // A document that rendered out of reading order renumbers every index the queue
    // and the WebView are holding; the engine is loaded again at the sentence
    // carried across (#46), and the clearing is what makes the old numbers go.
    expect(engine.slice(engine.indexOf('load(list, from = 0, options = {}) {'))).toMatch(
      /load\(list, from = 0, options = \{\}\) \{[\s\S]*?generation\+\+;[\s\S]*?restart\(from\);/,
    );
  });
});

describe('a Clip is kept only until it is queued (#49)', () => {
  /**
   * `drain` takes a Clip out of `prepared` as it queues it, so a queued Utterance
   * reports `absent`. A window starting at the cursor fetched every sentence a
   * second time, and `startFetch` kept that copy, which nothing behind
   * `nextToEnqueue` ever takes out again: ten sentences cost twenty cache lookups
   * in a probe of the real engine, and a PCM Clip is about 480 KB of float samples.
   * It fails as nothing at all — the reading is right, and memory grows.
   */
  const engine = code('engine.ts');

  it('asks the window to start at the first sentence not yet queued, and keeps nothing behind it', () => {
    const pump = engine.slice(engine.indexOf('function pump()'), engine.indexOf('function outOfText()'));
    pin(pump, 'fetchWindow({ cursor, nextToEnqueue, total: utterances.length, inFlight: inFlight.size, stateOf })', 'engine.ts, pump');
    const startFetch = engine.slice(engine.indexOf('function startFetch('), engine.indexOf('async function drain('));
    pin(startFetch, 'index >= nextToEnqueue && index <= enqueueCeiling(cursor)', 'engine.ts, startFetch');
  });
});

describe('a quiet load cues nothing until Play (#46)', () => {
  /**
   * A cue carries the renderer's `reveal`, which centres the page on its sentence.
   * A renumbering while paused is what scrolling up does — epub.js renders a
   * section above that has not reported — and the first cue of an engine reloaded
   * then pulled the page back to the reading while the owner scrolled away from
   * it. So `load` can be quiet, and its first cue waits for `play()`, a seek or a
   * load that is not. Nothing else cues while paused: positions and buffer ends
   * come only while the node renders, and `drain` stops on a refusal only while
   * playing.
   */
  const engine = code('engine.ts');
  const slice = (from: string, to: string) => engine.slice(engine.indexOf(from), engine.indexOf(to, engine.indexOf(from)));

  it('guards the first cue, sets the flag only on a paused quiet load, and clears it on Play and on every restart', () => {
    pin(slice('async function enqueue(', 'async function ensureGraph('), 'if ((cued === null || wasEmpty) && front && !quiet) cue(front);', 'engine.ts, enqueue');
    const enqueue = slice('async function enqueue(', 'async function ensureGraph(');
    pin(enqueue, 'const wasEmpty = timeline.pending() === 0;', 'engine.ts, before enqueue');
    expect(enqueue.indexOf('const wasEmpty = timeline.pending() === 0;')).toBeLessThan(enqueue.indexOf('queueAudio(audio,'));
    pin(slice('load(list, from = 0, options = {}) {', 'extend(list) {'), 'quiet = options.quiet === true && !playing;', 'engine.ts, load');
    pin(slice('function restart(', 'function cancelVoiceSwitch('), 'quiet = false;', 'engine.ts, restart');
    const play = slice('    play() {', 'pause: pauseNow,');
    pin(play, 'quiet = false;', 'engine.ts, play');
    // Cleared before the front is cued, or Play would cue nothing either.
    expect(play.indexOf('quiet = false;')).toBeLessThan(play.indexOf('cue(front);'));
    // And a rate change does not cue what a quiet load held back.
    pin(slice('setRate(next) {', 'switchVoice('), 'if (front && !quiet) cue(front);', 'engine.ts, setRate');
  });
});
