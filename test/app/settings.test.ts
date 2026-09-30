import { describe, expect, it, vi } from 'vitest';

import {
  andList,
  enabledProviders,
  recentEnabledVoice,
  selectVoice,
  DEFAULT_SETTINGS,
  headersAreOffered,
  isProviderId,
  keepWarm,
  providerFields,
  providerSettings,
  readiness,
  readinessNote,
  readinessSentence,
  engineIdentity,
  keyIsOffered,
  keyIsRequired,
  PROVIDER_ORDER,
  providerDeps,
  resolveTheme,
  settingsForDocument,
  synthesisOrigin,
  THEME_LABELS,
  THEME_SETTINGS,
  unusableVoiceSentence,
  type AppSettings,
} from '../../src/app/settings';
import { createProvider } from '../../src/core/providers/factory';

/**
 * The part of the app that is not the platform.
 *
 * `test/README.md` is explicit that React Native code is not tested here by
 * design, so what is reachable from Node is what `settings.ts` decides: whether
 * the app can speak, and what the key is joined to on its way to a Provider.
 * Those two are the ones worth holding — ADR 0014's "there is no zero-key path"
 * is a sentence the owner has to be shown rather than a failure to run into, and
 * ADR 0002's "a key arrives as a setting" is a claim about this one function.
 */

const settingsWith = (change: Partial<AppSettings>): AppSettings => ({ ...DEFAULT_SETTINGS, enabledProviders: [...PROVIDER_ORDER], ...change });

describe('readiness', () => {
  it('asks only for a Voice when there is none, because no Provider has been chosen either (#103)', () => {
    const found = readiness(settingsWith({}), false);
    expect(found).toEqual({ ready: false, missing: ['a Voice'] });
  });

  it('says no Provider is enabled before anything else, whichever Provider and Voice a book remembers (#103)', () => {
    expect(readiness({ ...DEFAULT_SETTINGS, provider: 'fish', voice: 'a-voice' }, true)).toEqual({ ready: false, missing: ['no provider'] });
    expect(readiness({ ...DEFAULT_SETTINGS, voice: '' }, false)).toEqual({ ready: false, missing: ['no provider'] });
  });

  it('asks for a Voice rather than for the Provider the settings start with, once another is enabled (#103)', () => {
    const fishOnly = { ...DEFAULT_SETTINGS, enabledProviders: ['fish'] as const, voice: '' };
    expect(readiness(fishOnly, false)).toEqual({ ready: false, missing: ['a Voice'] });
  });

  it('names a chosen Provider that was disabled while another is enabled', () => {
    const fishDisabled = { ...DEFAULT_SETTINGS, enabledProviders: ['local'] as const, provider: 'fish' as const, voice: 'a-voice' };
    expect(readiness(fishDisabled, true)).toEqual({ ready: false, missing: ['enabling'] });
  });

  it('names everything missing at once rather than one thing per trip to the sheet', () => {
    const found = readiness(settingsWith({ voice: 'nova' }), false);
    expect(found).toEqual({ ready: false, missing: ['an API key', 'a model'] });
  });

  it('is ready once OpenAI has a key, a model and a Voice', () => {
    const found = readiness(settingsWith({ openai: { model: 'a-speech-model' }, voice: 'nova' }), true);
    expect(found).toEqual({ ready: true });
  });

  it('asks Azure for a key and the region it was made in, and for a region id rather than anything typed', () => {
    const azure = settingsWith({ provider: 'azure', voice: 'en-US-AndrewNeural' });
    expect(readiness(azure, false)).toEqual({ ready: false, missing: ['an API key', 'a region'] });
    expect(readiness({ ...azure, azure: { region: 'east-asia' } }, true)).toEqual({ ready: false, missing: ['a region id such as eastasia'] });
    expect(readiness({ ...azure, azure: { region: 'East Asia' } }, true)).toEqual({ ready: true });
    expect(readinessSentence('azure', ['an API key', 'a region'])).toBe('Azure needs an API key and a region.');
  });

  it('asks a self-hosted server for an address and never for a key (ADR 0014)', () => {
    const local = settingsWith({ provider: 'local', voice: 'af_bella' });
    expect(readiness(local, false)).toEqual({ ready: true });
    expect(readiness({ ...local, local: { ...local.local, baseURL: '  ' } }, false)).toEqual({
      ready: false,
      missing: ['the address of the server'],
    });
  });

  it('refuses a local engine no adapter knows, rather than letting the factory throw', () => {
    const local = settingsWith({ provider: 'local', local: { engine: 'not-an-engine', baseURL: 'http://localhost:8880' }, voice: 'af_bella' });
    expect(readiness(local, false)).toEqual({ ready: false, missing: ['an engine the app knows'] });
  });

  it('lets an OpenAI-compatible server through with no key, because one that wants a key answers 401', () => {
    const compatible = settingsWith({
      provider: 'compatible',
      compatible: { baseURL: 'http://192.168.1.2:8000', model: 'a-model' },
      voice: 'alloy',
    });
    expect(readiness(compatible, false)).toEqual({ ready: true });
  });

  it('asks Speechify for a key and nothing else', () => {
    const speechify = settingsWith({ provider: 'speechify', voice: 'en-US-1' });
    expect(readiness(speechify, false)).toEqual({ ready: false, missing: ['an API key'] });
    expect(readiness(speechify, true)).toEqual({ ready: true });
  });

  it('never says a Provider is ready without a Voice, whatever else is set', () => {
    const noVoice = settingsWith({ provider: 'local', voice: '' });
    expect(readiness(noVoice, true)).toEqual({ ready: false, missing: ['a Voice'] });
  });
});

describe('readinessSentence', () => {
  it('reads as a sentence with one and two things missing', () => {
    expect(readinessSentence('openai-official', ['an API key'])).toBe('OpenAI needs an API key.');
    expect(readinessSentence('openai-official', ['an API key', 'a model'])).toBe('OpenAI needs an API key and a model.');
  });

  it('names no Provider when none is enabled or none has been chosen (#103)', () => {
    expect(readinessSentence('openai-official', ['no provider'])).toBe('No provider is enabled. Enable one in Settings to listen.');
    expect(readinessSentence('fish', ['no provider'])).toBe('No provider is enabled. Enable one in Settings to listen.');
    expect(readinessSentence('openai-official', ['a Voice'])).toBe('Choose a Voice.');
  });

  it('names the Provider a book chose when it has been disabled', () => {
    expect(readinessSentence('fish', ['enabling'])).toBe('Fish Audio is disabled. Choose an enabled provider.');
  });

  it('says so when nothing is missing', () => {
    expect(readinessSentence('speechify', [])).toBe('Speechify is ready.');
  });
});

describe('readinessNote', () => {
  it('says nothing when ready, or when only a Voice is missing, which the Voice button already says (#103)', () => {
    expect(readinessNote('fish', { ready: true })).toBeNull();
    expect(readinessNote('openai-official', { ready: false, missing: ['a Voice'] })).toBeNull();
  });

  it('says the readiness sentence for everything else', () => {
    expect(readinessNote('openai-official', { ready: false, missing: ['no provider'] })).toBe('No provider is enabled. Enable one in Settings to listen.');
    expect(readinessNote('fish', { ready: false, missing: ['enabling'] })).toBe('Fish Audio is disabled. Choose an enabled provider.');
    expect(readinessNote('fish', { ready: false, missing: ['an API key'] })).toBe('Fish Audio needs an API key.');
  });
});

describe('providerSettings', () => {
  it('puts the key in the section of the Provider it was typed for, and in no other', () => {
    const settings = settingsWith({ provider: 'openai-official', openai: { model: 'a-speech-model' } });
    const built = providerSettings(settings, { key: 'sk-the-owners-key', headers: '' });

    expect(built['openai-official']).toEqual({ apiKey: 'sk-the-owners-key', model: 'a-speech-model' });
    expect(built.compatible.apiKey).toBe('');
    expect(built.speechify.apiKey).toBe('');
  });

  it('gives Azure its key and region, and its key to no other section', () => {
    const settings = settingsWith({ provider: 'azure', azure: { region: 'eastasia' } });
    const built = providerSettings(settings, { key: 'an-azure-key', headers: 'X-Token: abc' });
    expect(built.azure).toEqual({ apiKey: 'an-azure-key', region: 'eastasia' });
    expect(built['openai-official'].apiKey).toBe('');
    expect(built.speechify.apiKey).toBe('');
    expect(built.compatible.headers).toBe('');
    expect(providerSettings(settingsWith({ provider: 'speechify' }), { key: 'a-speechify-key', headers: '' }).azure.apiKey).toBe('');
  });

  it('sends nothing typed for OpenAI to an OpenAI-compatible server', () => {
    const settings = settingsWith({
      provider: 'compatible',
      openai: { model: 'a-speech-model' },
      compatible: { baseURL: 'http://192.168.1.2:8000/', model: 'another-model' },
    });
    const built = providerSettings(settings, { key: 'a-hosted-key', headers: '' });

    expect(built.compatible).toEqual({ baseURL: 'http://192.168.1.2:8000/', apiKey: 'a-hosted-key', model: 'another-model', headers: '' });
    expect(built['openai-official'].apiKey).toBe('');
  });

  it('never hands a key to a server of the owner’s own, which has none', () => {
    const settings = settingsWith({ provider: 'local' });
    const built = providerSettings(settings, { key: 'a-key-from-somewhere', headers: '' });
    expect(built).toMatchObject({ local: { engine: settings.local.engine, baseURL: settings.local.baseURL } });
    // The section has no `apiKey` at all — not an empty one. ADR 0014's one
    // configuration that needs no credentials has nowhere for a key to sit.
    expect(Object.keys(built.local).sort()).toEqual(['baseURL', 'engine', 'headers']);
  });

  it('trims what was typed, because a trailing space in an address is a different address', () => {
    const settings = settingsWith({ provider: 'compatible', compatible: { baseURL: ' http://host:8000 ', model: ' a-model ' } });
    const built = providerSettings(settings, { key: '', headers: '' });
    expect(built.compatible.baseURL).toBe('http://host:8000');
    expect(built.compatible.model).toBe('a-model');
  });
});

describe('engineIdentity', () => {
  it('changes with the Provider, the Voice and the address, because each is a different engine', () => {
    const base = settingsWith({ voice: 'nova' });
    expect(engineIdentity(base)).not.toBe(engineIdentity({ ...base, voice: 'alloy' }));
    expect(engineIdentity(base)).not.toBe(engineIdentity({ ...base, provider: 'speechify' }));
    expect(engineIdentity(base)).not.toBe(engineIdentity({ ...base, openai: { model: 'another' } }));
  });

  it('changes with the Azure region, since a different region is a different host', () => {
    const base = settingsWith({ provider: 'azure', voice: 'en-US-AndrewNeural', azure: { region: 'eastasia' } });
    expect(engineIdentity(base)).not.toBe(engineIdentity({ ...base, azure: { region: 'westus2' } }));
  });

  it('does not change with the rate: speed is a live parameter of the graph, not a new engine (ADR 0009)', () => {
    const base = settingsWith({ voice: 'nova', rate: 1.5 });
    expect(engineIdentity({ ...base, rate: 3 })).toBe(engineIdentity(base));
  });
});

describe('what the owner is offered', () => {
  it('offers a key field to every Provider that has one, and requires it of the two hosted services', () => {
    expect(keyIsOffered('local')).toBe(false);
    expect(keyIsOffered('compatible')).toBe(true);
    expect(keyIsRequired('compatible')).toBe(false);
    expect(keyIsRequired('openai-official')).toBe(true);
    expect(keyIsRequired('azure')).toBe(true);
    expect(keyIsRequired('speechify')).toBe(true);
  });

});

describe('explicit provider enablement', () => {
  it('offers nothing on first run, even with the prefilled local address', () => {
    expect(enabledProviders(DEFAULT_SETTINGS)).toEqual([]);
    expect(readiness(DEFAULT_SETTINGS, true)).toEqual({ ready: false, missing: ['no provider'] });
  });
  it('offers only enabled providers, in display order', () => {
    expect(enabledProviders({ ...DEFAULT_SETTINGS, enabledProviders: ['local', 'fish'] })).toEqual(['fish', 'local']);
  });
  it('invalidates the active engine on disable, without losing the document voice', () => {
    const settings = settingsWith({ provider: 'fish', voice: 'voice' });
    const disabled = { ...settings, enabledProviders: [] };
    expect(engineIdentity(disabled)).not.toBe(engineIdentity(settings));
    expect(settingsForDocument(disabled, { provider: 'fish', voice: 'voice' }).voice).toBe('voice');
    expect(readiness(disabled, true).ready).toBe(false);
  });
  it('does not interrupt the active engine when another provider is disabled', () => {
    const settings = settingsWith({ provider: 'fish', voice: 'voice' });
    expect(engineIdentity({ ...settings, enabledProviders: ['fish'] })).toBe(engineIdentity(settings));
    expect(engineIdentity({ ...settings, local: { ...settings.local, baseURL: 'https://changed.example' } })).toBe(engineIdentity(settings));
  });
  it('finds the latest still-enabled voice for new documents and rejects disabled selections', () => {
    const first = selectVoice(settingsWith({}), 'fish', 'one');
    const second = selectVoice(first, 'local', 'two');
    const disabled = { ...second, enabledProviders: ['fish'] as const };
    expect(recentEnabledVoice(disabled)).toEqual({ provider: 'fish', voice: 'one' });
    expect(settingsForDocument(disabled, null)).toMatchObject({ provider: 'fish', voice: 'one' });
    expect(selectVoice(disabled, 'local', 'three')).toBe(disabled);
    expect(recentEnabledVoice({ ...disabled, enabledProviders: [] })).toBeNull();
  });
  it('only includes official Fish voices by default and forwards changes', () => {
    expect(providerSettings(DEFAULT_SETTINGS, { key: '', headers: '' }).fish).toMatchObject({ includeOfficial: true, includeOwn: false, includeManual: false });
    const settings = { ...DEFAULT_SETTINGS, fish: { includeOfficial: false, includeOwn: true, includeManual: true, voices: 'abc' } };
    expect(providerSettings(settings, { key: '', headers: '' }).fish).toMatchObject(settings.fish);
  });
});

/**
 * The gateway headers (ADR 0019).
 *
 * The provider layer has taken these since it was ported — `factory.ts` calls
 * `parseHeaderList` on `local.headers` and on `compatible.headers` — and no
 * settings field held them, which is the whole of why a Kokoro behind an access
 * gateway answered 403 and every Word Timing this project had processed was
 * synthetic (notes/NOTES_2026-09-19.md, 22:48). So the assertion worth making is
 * not that a string is copied: it is that what the owner types reaches the
 * **request**, and reaches no other Provider's.
 */
describe('gateway headers', () => {
  const TOKEN = 'CF-Access-Client-Id: an-id.access; CF-Access-Client-Secret: a-secret';

  it('is offered by exactly the sections that have somewhere to put it', () => {
    // Tied to the shape rather than to a list, because the failure this guards
    // is a field on a screen that goes nowhere (philosophy rule 6: a setting
    // must do something). `providerSettings` writes `headers` into the two
    // sections `ProviderSettings` declares it on and no others, so the
    // predicate the screen asks and the object the factory reads cannot drift
    // apart without this failing.
    const built = providerSettings(DEFAULT_SETTINGS, { key: '', headers: TOKEN });
    for (const provider of PROVIDER_ORDER) {
      expect(Object.keys(built[provider]).includes('headers'), provider).toBe(headersAreOffered(provider));
    }
  });

  it('goes into the section of the Provider it was typed for, and into no other', () => {
    // Philosophy rule 3, and the one place it can be enforced. The owner's own
    // desktop export carries one copy of this text under three service keys;
    // this app keeps one entry per Provider so that the copy typed for one
    // cannot be sent to another.
    const local = providerSettings(settingsWith({ provider: 'local' }), { key: '', headers: TOKEN });
    expect(local.local.headers).toBe(TOKEN);
    expect(local.compatible.headers).toBe('');

    const compatible = providerSettings(settingsWith({ provider: 'compatible' }), { key: '', headers: TOKEN });
    expect(compatible.compatible.headers).toBe(TOKEN);
    expect(compatible.local.headers).toBe('');
  });

  it('arrives as request headers at the owner’s own server', async () => {
    // Through the real `createProvider`, because the step that was missing was
    // never inside this file: the settings object is only worth anything if the
    // factory parses it and the engine sends it. A fake `fetch` is the only
    // stand-in — `test/setup.ts` replaces the global one with a throw so that a
    // test which forgot is a failure rather than a real request.
    const sent: Record<string, string>[] = [];
    const provider = createProvider(
      'local',
      providerSettings(settingsWith({ provider: 'local', local: { engine: 'kokoro', baseURL: 'http://a-machine-of-my-own:8880' } }), {
        key: '',
        headers: TOKEN,
      }),
      {
        ...providerDeps,
        fetch: async (_input, init) => {
          sent.push((init?.headers as Record<string, string>) ?? {});
          return new Response(JSON.stringify({ voices: ['zf_xiaoxiao'] }), { status: 200 });
        },
      },
    );

    await provider.listVoices();
    expect(sent).toHaveLength(1);
    expect(sent[0]['CF-Access-Client-Id']).toBe('an-id.access');
    expect(sent[0]['CF-Access-Client-Secret']).toBe('a-secret');
  });

  it('sends none where the owner typed none, rather than an empty one', async () => {
    // An empty header is not the same as no header: a gateway that reads a
    // client id it was sent as the empty string refuses differently from one
    // that was sent nothing, and the owner would be told the wrong thing.
    const sent: Record<string, string>[] = [];
    const provider = createProvider(
      'local',
      providerSettings(settingsWith({ provider: 'local', local: { engine: 'kokoro', baseURL: 'http://a-machine-of-my-own:8880' } }), {
        key: '',
        headers: '',
      }),
      {
        ...providerDeps,
        fetch: async (_input, init) => {
          sent.push((init?.headers as Record<string, string>) ?? {});
          return new Response(JSON.stringify({ voices: [] }), { status: 200 });
        },
      },
    );

    await provider.listVoices();
    expect(Object.keys(sent[0])).toEqual([]);
  });
});

describe('what a Provider’s row says is behind it', () => {
  it('names the gateway headers on exactly the Providers that offer them', () => {
    // The row is what the owner reads before tapping, and ADR 0019 split the
    // screen so that the fields shown are the ones that apply. A row that did
    // not mention a field its screen holds would re-create, one level up, the
    // thing the split removed.
    for (const provider of PROVIDER_ORDER) {
      const mentionsHeaders = providerFields(provider).some((field) => field.includes('gateway'));
      expect(mentionsHeaders, provider).toBe(headersAreOffered(provider));
    }
  });

  it('names an API key on exactly the Providers that have one', () => {
    for (const provider of PROVIDER_ORDER) {
      const mentionsKey = providerFields(provider).some((field) => field.includes('API key'));
      expect(mentionsKey, provider).toBe(keyIsOffered(provider));
    }
  });

  it('names the region on Azure’s row, and on no other', () => {
    for (const provider of PROVIDER_ORDER) {
      expect(providerFields(provider).includes('a region'), provider).toBe(provider === 'azure');
    }
  });

  it('never claims a Provider that is not in use holds a Voice, because there is one Voice and it belongs to the one that is', () => {
    for (const provider of PROVIDER_ORDER) {
      expect(providerFields(provider).join(' '), provider).not.toContain('Voice');
    }
  });

  it('reads as a sentence at one, two and three fields', () => {
    expect(andList([])).toBe('');
    expect(andList(['an engine'])).toBe('an engine');
    expect(andList(['an engine', 'an address'])).toBe('an engine and an address');
    expect(andList(['an engine', 'an address', 'a token'])).toBe('an engine, an address and a token');
  });
});

/**
 * The theme, which is the one decision in ADR 0022 that is not a stylesheet.
 *
 * Three settings, two themes, and three callers of the answer — the app's own
 * colours, the status bar, and the stylesheet that reaches the page. The reason
 * it is one function rather than a conditional at each of those is that three
 * copies is three chances for the chrome and the document to disagree, which on a
 * dark theme shows up as a white rectangle in the middle of a dark screen.
 */
describe('the theme (ADR 0022)', () => {
  it('follows the system by default, which is the only default that is not a guess about the room', () => {
    expect(DEFAULT_SETTINGS.theme).toBe('system');
  });

  it('keeps a chosen theme whatever the phone does at sunset', () => {
    for (const system of ['light', 'dark', 'unspecified', null, undefined] as const) {
      expect({ system, is: resolveTheme('light', system) }).toEqual({ system, is: 'light' });
      expect({ system, is: resolveTheme('dark', system) }).toEqual({ system, is: 'dark' });
    }
  });

  it('reads everything the platform can say that is not dark as light', () => {
    // React Native answers with four things, not two: 'light', 'dark',
    // 'unspecified' — a window whose style has been given back to the system — and
    // null, before it has said anything at all. Light is the right reading of the
    // last two because it is what the page already is: a wrong guess corrects to
    // dark in a frame, while the other way round flashes a black page at someone
    // reading in daylight.
    expect(resolveTheme('system', 'dark')).toBe('dark');
    expect(resolveTheme('system', 'light')).toBe('light');
    expect(resolveTheme('system', 'unspecified')).toBe('light');
    expect(resolveTheme('system', null)).toBe('light');
    expect(resolveTheme('system', undefined)).toBe('light');
  });

  it('offers the two answers before the one that defers, and names each of them', () => {
    expect(THEME_SETTINGS).toEqual(['light', 'dark', 'system']);
    for (const setting of THEME_SETTINGS) expect(THEME_LABELS[setting].length, setting).toBeGreaterThan(0);
  });
});

/**
 * A Voice belongs to a **Document** (ADR 0010, design 0010), and this is where the
 * one it remembers becomes the one it is read with.
 *
 * The file format has carried `LibraryEntry.voice` since it was written and nothing
 * ever set it, so design 0010 described an app that did not exist — one global Voice,
 * which on a shelf holding a Chinese novel and an English document is wrong for one
 * of them whichever way it is set (notes/NOTES_2026-09-20.md, 07:38). These are the
 * two halves that could not be tested through a screen: which settings a Document is
 * read with, and what is said about one this build cannot honour.
 */
describe('settingsForDocument', () => {
  const chosen = selectVoice(settingsWith({ openai: { model: 'tts-1' } }), 'openai-official', 'alloy');

  it('reads a Document in the Voice it remembers, not the global default', () => {
    const forDocument = settingsForDocument(chosen, { provider: 'fish', voice: 'zh/74c6aba5' });
    expect(forDocument.provider).toBe('fish');
    expect(forDocument.voice).toBe('zh/74c6aba5');
  });

  it('moves the pair and nothing else: a model, an address and the Appearance are the app’s', () => {
    const forDocument = settingsForDocument(chosen, { provider: 'fish', voice: 'zh/74c6aba5' });
    expect(forDocument.openai.model).toBe('tts-1');
    expect(forDocument.rate).toBe(chosen.rate);
    expect(forDocument.appearance).toBe(chosen.appearance);
    expect(forDocument.theme).toBe(chosen.theme);
  });

  it('is the global default for a Document that remembers nothing', () => {
    // Which is what "opening one for the first time gives it whatever the default is
    // at that moment" needs: until it is written down, the default *is* the answer.
    expect(settingsForDocument(chosen, null)).toEqual(chosen);
  });

  it('is a different engine, which is what makes the two books not disturb each other', () => {
    // `engineIdentity` is what `use-reading.ts` rebuilds on, so this is the property
    // that stops one book's Voice being spoken in another's.
    const one = settingsForDocument(chosen, { provider: 'fish', voice: 'zh/74c6aba5' });
    const other = settingsForDocument(chosen, { provider: 'speechify', voice: 'george' });
    expect(engineIdentity(one)).not.toBe(engineIdentity(other));
    expect(engineIdentity(settingsForDocument(chosen, null))).toBe(engineIdentity(chosen));
  });

  it('ignores a Voice from a Provider this build does not have, rather than throwing one', () => {
    // ADR 0003 keeps the Library file readable by a build with fewer Providers than
    // wrote it; `core/document/library.ts` carries the pair as written for exactly
    // this reason. Losing a place because a Voice named something unfamiliar would be
    // the worst possible trade.
    expect(settingsForDocument(chosen, { provider: 'elevenlabs', voice: 'rachel' })).toEqual(chosen);
    expect(settingsForDocument(chosen, { provider: 'fish', voice: '   ' })).toEqual(chosen);
  });

  it('says so, in a sentence, rather than reading the book in a stranger in silence', () => {
    const said = unusableVoiceSentence({ provider: 'elevenlabs', voice: 'rachel' });
    expect(said).toContain('elevenlabs');
    expect(said).toContain('this version of the app does not have');
    expect(unusableVoiceSentence({ provider: 'fish', voice: 'zh/74c6aba5' })).toBeNull();
    expect(unusableVoiceSentence(null)).toBeNull();
  });
});

/**
 * Where each Provider's synthesis goes, so that saved audio can keep that
 * connection warm while it plays (#26, ADR 0040).
 */
describe('synthesisOrigin', () => {
  it('is the fixed address of each hosted Provider', () => {
    expect(synthesisOrigin(DEFAULT_SETTINGS, 'fish')).toBe('https://api.fish.audio');
    expect(synthesisOrigin(DEFAULT_SETTINGS, 'openai-official')).toBe('https://api.openai.com');
    expect(synthesisOrigin(DEFAULT_SETTINGS, 'speechify')).toBe('https://api.speechify.ai');
  });

  it('is the address the owner typed for a server of their own', () => {
    const typed = settingsWith({
      compatible: { baseURL: ' https://api.groq.com/openai/v1 ', model: 'playai-tts' },
      local: { engine: 'kokoro', baseURL: 'http://192.168.31.28:8880/v1' },
    });
    expect(synthesisOrigin(typed, 'compatible')).toBe('https://api.groq.com');
    expect(synthesisOrigin(typed, 'local')).toBe('http://192.168.31.28:8880');
    // None typed yet: nothing to keep warm.
    expect(synthesisOrigin(DEFAULT_SETTINGS, 'compatible')).toBeNull();
  });

  it('is none for Azure, which opens a connection of its own for every synthesis', () => {
    expect(synthesisOrigin(settingsWith({ azure: { region: 'eastasia' } }), 'azure')).toBeNull();
  });
});

describe('the connection every Provider request goes through (#26)', () => {
  it('warms a quiet origin before a POST, and keeps warm the same connections it has seen', async () => {
    const start = Date.parse('2026-09-23T12:57:00Z');
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(start);
    const sent: string[] = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      sent.push(`${init?.method ?? 'GET'} ${String(input)}`);
      return new Response(null, { status: 200 });
    }) as typeof fetch;
    try {
      await providerDeps.fetch('https://quiet.example/v1/models');
      vi.setSystemTime(start + 107_000);
      await providerDeps.fetch('https://quiet.example/v1/audio/speech', { method: 'POST', body: '{}' });
      // One instance behind both: `keepWarm` knows the origin because a Provider reached it.
      vi.setSystemTime(start + 127_000);
      keepWarm('https://quiet.example');
      keepWarm(null);
      await Promise.resolve();
      expect(sent).toEqual([
        'GET https://quiet.example/v1/models',
        'GET https://quiet.example/',
        'POST https://quiet.example/v1/audio/speech',
        'GET https://quiet.example/',
      ]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('isProviderId', () => {
  it('answers for every Provider this build has, and for nothing else', () => {
    for (const provider of PROVIDER_ORDER) expect(isProviderId(provider)).toBe(true);
    expect(isProviderId('elevenlabs')).toBe(false);
    expect(isProviderId('')).toBe(false);
    // Not a property of the object it might be read off: a key that exists on every
    // object must not answer true.
    expect(isProviderId('toString')).toBe(false);
  });
});
