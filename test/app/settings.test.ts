import { describe, expect, it } from 'vitest';

import {
  andList,
  DEFAULT_SETTINGS,
  headersAreOffered,
  providerFields,
  providerSettings,
  readiness,
  readinessSentence,
  engineIdentity,
  keyIsOffered,
  keyIsRequired,
  PROVIDER_ORDER,
  READING_RATES,
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

const settingsWith = (change: Partial<AppSettings>): AppSettings => ({ ...DEFAULT_SETTINGS, ...change });

describe('readiness', () => {
  it('refuses to claim OpenAI can speak with no key, no model and no Voice', () => {
    const found = readiness(DEFAULT_SETTINGS, false);
    expect(found).toEqual({ ready: false, missing: ['an API key', 'a model', 'a Voice'] });
  });

  it('names everything missing at once rather than one thing per trip to the sheet', () => {
    const found = readiness(settingsWith({ voice: 'nova' }), false);
    expect(found).toEqual({ ready: false, missing: ['an API key', 'a model'] });
  });

  it('is ready once OpenAI has a key, a model and a Voice', () => {
    const found = readiness(settingsWith({ openai: { model: 'a-speech-model' }, voice: 'nova' }), true);
    expect(found).toEqual({ ready: true });
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
  it('reads as a sentence with one, two and three things missing', () => {
    expect(readinessSentence('openai-official', ['an API key'])).toBe('OpenAI needs an API key.');
    expect(readinessSentence('openai-official', ['an API key', 'a Voice'])).toBe('OpenAI needs an API key and a Voice.');
    expect(readinessSentence('openai-official', ['an API key', 'a model', 'a Voice'])).toBe(
      'OpenAI needs an API key, a model and a Voice.',
    );
  });

  it('says so when nothing is missing', () => {
    expect(readinessSentence('speechify', [])).toBe('Speechify is ready.');
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
    expect(keyIsRequired('speechify')).toBe(true);
  });

  it('offers the 1.5–3× the app is built for, and Natural Pace to compare it against', () => {
    expect(READING_RATES).toContain(1);
    expect(READING_RATES).toContain(1.5);
    expect(READING_RATES).toContain(3);
    expect(Math.max(...READING_RATES)).toBe(3);
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
