import { expect, it } from 'vitest';
import { downloadSpeech, speechKeying } from '../../src/offline/speech';

const on = { stripBrackets: true, bracketPairs: '<> []' };
const off = { stripBrackets: false, bracketPairs: '<> []' };

it('sends and names a downloaded sentence by the Speech Text reading asks for (#25)', () => {
  expect(downloadSpeech('He cast [Fireball] at the wolf.', on)).toBe('He cast Fireball at the wolf.');
  expect(downloadSpeech('He cast [Fireball] at the wolf.', off)).toBe('He cast [Fireball] at the wolf.');
  expect(downloadSpeech('If x < 5 and y > 3, stop.', on)).toBe('If x < 5 and y > 3, stop.');
});

it('records the switch, and the list only while the switch is on', () => {
  expect(speechKeying(on)).toBe('[true,"<> []"]');
  expect(speechKeying({ ...on, bracketPairs: '【】' })).toBe('[true,"【】"]');
  expect(speechKeying(off)).toBe('[false]');
  expect(speechKeying({ ...off, bracketPairs: '【】' })).toBe(speechKeying(off));
});
