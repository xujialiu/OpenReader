import { describe, expect, it } from 'vitest';

import {
  DEFAULT_SETTINGS,
  providerSettings,
  readiness,
  readinessSentence,
  engineIdentity,
  keyIsOffered,
  keyIsRequired,
  READING_RATES,
  type AppSettings,
} from '../../src/app/settings';

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
    const built = providerSettings(settings, 'sk-the-owners-key');

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
    const built = providerSettings(settings, 'a-gateway-token');

    expect(built.compatible).toEqual({ baseURL: 'http://192.168.1.2:8000/', apiKey: 'a-gateway-token', model: 'another-model' });
    expect(built['openai-official'].apiKey).toBe('');
  });

  it('never hands a key to a server of the owner’s own, which has none', () => {
    const settings = settingsWith({ provider: 'local' });
    expect(providerSettings(settings, 'a-key-from-somewhere')).toMatchObject({
      local: { engine: settings.local.engine, baseURL: settings.local.baseURL },
    });
    expect(Object.keys(providerSettings(settings, 'a-key-from-somewhere').local)).toEqual(['engine', 'baseURL']);
  });

  it('trims what was typed, because a trailing space in an address is a different address', () => {
    const settings = settingsWith({ provider: 'compatible', compatible: { baseURL: ' http://host:8000 ', model: ' a-model ' } });
    const built = providerSettings(settings, '');
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
