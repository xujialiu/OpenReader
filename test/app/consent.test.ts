import { describe, expect, it, vi } from 'vitest';

import { SynthesisError } from '../../src/core/providers/errors';
import { consent, CONSENT_KEY, consentQuestion, declinedSentence, isDeclined, lookupRecipient, providerRecipient } from '../../src/app/consent';
import { DEFAULT_SETTINGS, type AppSettings } from '../../src/app/settings';
import { parseSettings } from '../../src/app/settings-storage';
import { DEFAULT_LOOKUP } from '../../src/translation/settings';

// The settings file's projection is what is tested, not the file.
vi.mock('expo-file-system', () => ({ Paths: { document: 'test' }, File: class {} }));

/**
 * #109, ADR 0064: who a service is to the person, and what they are asked
 * before it receives text. The wording is the owner's, approved on 2026-09-30.
 */

const serverAt = (compatible: string, local = DEFAULT_SETTINGS.local.baseURL): AppSettings => ({
  ...DEFAULT_SETTINGS,
  compatible: { baseURL: compatible, model: 'tts-1' },
  local: { ...DEFAULT_SETTINGS.local, baseURL: local },
});

describe('who receives a Document\'s text', () => {
  it('names a hosted Provider as the app does, and asks in the approved words', () => {
    const fish = providerRecipient(DEFAULT_SETTINGS, 'fish', true);
    expect(fish).toMatchObject({ key: 'provider:fish', name: 'Fish Audio', sends: 'document', withKey: true, company: true });
    expect(consentQuestion(fish)).toEqual({
      title: 'Send text to Fish Audio?',
      message: 'To read aloud, OpenReader sends your document\'s text to Fish Audio with your API key. Fish Audio\'s privacy policy applies.',
    });
    expect(providerRecipient(DEFAULT_SETTINGS, 'openai-official', true).name).toBe('OpenAI');
    expect(providerRecipient(DEFAULT_SETTINGS, 'azure', true).name).toBe('Azure');
    expect(providerRecipient(DEFAULT_SETTINGS, 'speechify', true).name).toBe('Speechify');
  });

  it('keeps one answer for a hosted Provider, whatever it is configured with', () => {
    const one = providerRecipient({ ...DEFAULT_SETTINGS, azure: { region: 'eastasia' } }, 'azure', true);
    const other = providerRecipient({ ...DEFAULT_SETTINGS, azure: { region: 'westus' } }, 'azure', true);
    expect(one.key).toBe(other.key);
  });

  it('names a server at a typed address by its host, without a privacy policy or a key it was not given', () => {
    const server = providerRecipient(serverAt('http://192.168.1.20:8880/v1'), 'compatible', false);
    expect(server).toMatchObject({ key: 'provider:compatible@http://192.168.1.20:8880', name: 'the server at 192.168.1.20:8880', withKey: false, company: false });
    expect(consentQuestion(server)).toEqual({
      title: 'Send text to the server at 192.168.1.20:8880?',
      message: 'To read aloud, OpenReader sends your document\'s text to the server at 192.168.1.20:8880.',
    });
    expect(consentQuestion(providerRecipient(serverAt('https://tts.example.net/v1'), 'compatible', true)).message)
      .toBe('To read aloud, OpenReader sends your document\'s text to the server at tts.example.net with your API key.');
  });

  it('asks again about another server, and not about another path on the same one', () => {
    const first = providerRecipient(serverAt('http://192.168.1.20:8880/v1'), 'compatible', false);
    expect(providerRecipient(serverAt('http://192.168.1.20:8880/other'), 'compatible', false).key).toBe(first.key);
    expect(providerRecipient(serverAt('http://192.168.1.21:8880/v1'), 'compatible', false).key).not.toBe(first.key);
    expect(providerRecipient(serverAt('https://192.168.1.20:8880/v1'), 'compatible', false).key).not.toBe(first.key);
  });

  it('never says a key goes to Kokoro-FastAPI, which has none', () => {
    const local = providerRecipient(serverAt('', 'http://127.0.0.1:8880'), 'local', true);
    expect(local).toMatchObject({ key: 'provider:local@http://127.0.0.1:8880', name: 'the server at 127.0.0.1:8880', withKey: false });
  });
});

describe('who receives a selection', () => {
  const recipient = (mode: 'dictionary' | 'translation', patch: Partial<typeof DEFAULT_LOOKUP> = {}, hasKey = false) =>
    lookupRecipient({ ...DEFAULT_LOOKUP, ...patch, mode }, hasKey);

  it('asks in the approved words', () => {
    expect(consentQuestion(recipient('dictionary', { direction: 'en-zh' }))).toEqual({
      title: 'Send selected text to Youdao?',
      message: 'Word Lookup sends the text you select to Youdao.',
    });
  });

  it('is the service lookup() sends to: the Free Dictionary API for English → English, and Youdao for the others', () => {
    expect(recipient('dictionary', { direction: 'en-en' })).toMatchObject({ key: 'lookup:free-dictionary', name: 'the Free Dictionary API' });
    expect(recipient('dictionary', { direction: 'zh-en' }).key).toBe('lookup:youdao');
    expect(recipient('translation', { service: 'youdao' }).key).toBe('lookup:youdao');
    expect(recipient('translation', { service: 'google' })).toMatchObject({ key: 'lookup:google', name: 'Google' });
    expect(recipient('translation', { service: 'microsoft' })).toMatchObject({ key: 'lookup:microsoft', name: 'Microsoft Translator' });
  });

  it('says a key goes with the selection only to Microsoft Translator, and only when there is one', () => {
    expect(consentQuestion(recipient('translation', { service: 'microsoft' }, true)).message)
      .toBe('Word Lookup sends the text you select to Microsoft Translator with your API key.');
    expect(recipient('translation', { service: 'microsoft' }, false).withKey).toBe(false);
    expect(recipient('translation', { service: 'google' }, true).withKey).toBe(false);
  });
});

describe('where a yes is kept', () => {
  it('keeps every key a recipient can have, on this device, and nothing else', () => {
    const keys = [
      providerRecipient(DEFAULT_SETTINGS, 'fish', true).key,
      providerRecipient(serverAt('http://192.168.1.20:8880/v1'), 'compatible', false).key,
      providerRecipient(serverAt('', 'http://127.0.0.1:8880'), 'local', false).key,
      lookupRecipient({ ...DEFAULT_LOOKUP, mode: 'dictionary', direction: 'en-en' }, false).key,
    ];
    for (const key of keys) expect(key).toMatch(CONSENT_KEY);
    const read = parseSettings({ version: 1, settings: { ...DEFAULT_SETTINGS, consent: [...keys, keys[0], 42, '', 'anything'] } });
    expect(read.consent).toEqual(keys);
  });

  it('starts with nothing allowed, and reads a file from before the question as nothing allowed', () => {
    expect(DEFAULT_SETTINGS.consent).toEqual([]);
    expect(parseSettings({ version: 1, settings: { provider: 'fish' } }).consent).toEqual([]);
  });
});

describe('before the shell has configured the gate', () => {
  it('allows nothing and asks nobody, so no text can leave before there is a way to ask', async () => {
    expect(await consent.ensure(providerRecipient(DEFAULT_SETTINGS, 'fish', true))).toBe(false);
  });
});

describe('a refusal', () => {
  it('is its own kind of synthesis error, not retried, with a sentence a stopped download can show', () => {
    const fish = providerRecipient(DEFAULT_SETTINGS, 'fish', true);
    const error = new SynthesisError('declined', declinedSentence(fish));
    expect(isDeclined(error)).toBe(true);
    expect(error.retriable).toBe(false);
    expect(error.message).toBe('Fish Audio was not allowed to receive this document\'s text.');
    expect(declinedSentence(providerRecipient(serverAt('http://192.168.1.20:8880'), 'compatible', false)))
      .toBe('The server at 192.168.1.20:8880 was not allowed to receive this document\'s text.');
    expect(isDeclined(new SynthesisError('auth'))).toBe(false);
    expect(isDeclined(new Error('declined'))).toBe(false);
  });
});
