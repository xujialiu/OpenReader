import { expect, it } from 'vitest';
import { downloadActionLine, offlineSummaryLine } from '../../src/offline/diagnostics';
import type { DownloadTask } from '../../src/offline/model';

const voice = { provider: 'fish' as const, voice: 'en/voice-id', label: 'Dax', model: 's2.1-pro-free' };
it('names the exact Voice, Model and trigger, with bounded fields and no speech text', () => {
  const task: DownloadTask = { id: 'task', document: 'sha256:12345678abcd', voice, state: 'queued', chapters: ['a', 'b'], error: null, failed: [], recheckHeld: ['b'] };
  const line = downloadActionLine('resumed', task, 'Book', 'Resume all');
  expect(line).toContain('Dax'); expect(line).toContain('en/voice-id'); expect(line).toContain('s2.1-pro-free');
  expect(line).toContain('2 chapters'); expect(line).toContain('Recheck-held=1'); expect(line).toContain('from Resume all');
  expect(downloadActionLine('started', { ...task, voice: { ...voice, label: 'x'.repeat(5000), voice: 'y'.repeat(5000), model: 'z'.repeat(5000) } }, 'b'.repeat(5000), 'Download selected').length).toBeLessThan(1900);
});
it('distinguishes pending Recheck from missing audio even while the check is retained', () => {
  const line = offlineSummaryLine('book', 'Book', voice, { chapters: 2, downloaded: 1, awaiting: 2, partial: 1, unprepared: 0, allSaved: 1, clips: 10, orphans: 3 });
  expect(line).toContain('1 Downloaded, 2 awaiting Recheck, 1 partly saved');
  expect(line).toContain('10 ready Clips, 3 unmatched');
});
