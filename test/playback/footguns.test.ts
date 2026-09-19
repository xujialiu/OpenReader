import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

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

  it('stops the node only when the engine is disposed of', () => {
    // Buffer exhaustion cannot schedule a stop; adding one is what breaks
    // resumption. The only stop() is in teardown, where the owner has finished.
    const graph = code('audio-graph.ts');
    const stops = [...graph.matchAll(/node\.stop\(/g)];
    expect(stops).toHaveLength(1);
    const dispose = graph.indexOf('async dispose()');
    expect(dispose).toBeGreaterThan(-1);
    expect(stops[0]!.index!).toBeGreaterThan(dispose);
  });

  it('does not clear or stop on a seek beyond the clearBuffers a seek is', () => {
    const engine = code('engine.ts');
    expect(engine).not.toMatch(/graph\?\.stop\(/);
    // Resuming after clearBuffers would be the defensive restart footgun 3 warns
    // about: the node stays in the playing state and an empty queue renders
    // silence until the next buffer arrives.
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
    expect(calls).toHaveLength(1);
    for (const call of calls) expect(call[1]).toContain('pitchCorrection: true');
  });

  it('clamps the rate to the same ceiling the stretcher does', () => {
    // WsolaTimeStretcher::MAX_PLAYBACK_RATE is 4 and the audio thread clamps to
    // it. A rate above 4 would play at 4 while the timings were divided by the
    // larger number.
    expect(code('rate.ts')).toContain('MAX_PLAYBACK_RATE = 4');
    expect(code('engine.ts')).toMatch(/graph\?\.setRate\(rate\)/);
    expect(code('engine.ts')).toMatch(/rate = clampRate\(/);
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
    expect(graph).toMatch(/node\.onPositionChanged\s*=/);
    expect(graph).toMatch(/node\.onPositionChangedInterval\s*=/);
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
