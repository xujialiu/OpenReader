import { describe, expect, it, vi } from 'vitest';
import { createPronunciationController } from '../../src/translation/pronunciation';
function setup(initiallyPlaying: boolean) {
  let playing = initiallyPlaying;
  const jobs: { finish(): void; reject(): void; signal: AbortSignal }[] = [];
  const pause = vi.fn(() => { playing = false; });
  const resume = vi.fn(() => { playing = true; });
  const failed = vi.fn();
  const controller = createPronunciationController({ playing: () => playing, pause, resume, failed, changed: vi.fn(),
    audio: (_url, signal) => new Promise<void>((resolve, reject) => { jobs.push({ finish: resolve, reject: () => reject(new Error('network')), signal }); }),
  });
  return { controller, jobs, pause, resume, failed };
}
describe('pronunciation interruption', () => {
  it('resumes only speech it interrupted, after pronunciation ends', async () => {
    const t = setup(true); const p = t.controller.play('audio');
    expect(t.pause).toHaveBeenCalledTimes(1); expect(t.resume).not.toHaveBeenCalled();
    t.jobs[0].finish(); await p; expect(t.resume).toHaveBeenCalledTimes(1);
    const paused = setup(false); const p2 = paused.controller.play('audio'); paused.jobs[0].finish(); await p2;
    expect(paused.resume).not.toHaveBeenCalled();
  });
  it('restarting cannot resume narration under the newer pronunciation', async () => {
    const t = setup(true); const one = t.controller.play('one'); const two = t.controller.play('two');
    expect(t.jobs[0].signal.aborted).toBe(true);
    t.jobs[0].finish(); await one; expect(t.resume).not.toHaveBeenCalled();
    t.jobs[1].finish(); await two; expect(t.resume).toHaveBeenCalledTimes(1);
  });
  it('manual transport, backgrounding or output loss revokes resumption', async () => {
    const t = setup(true); const pending = t.controller.play('audio'); t.controller.stop(false);
    t.jobs[0].finish(); await pending; expect(t.resume).not.toHaveBeenCalled();
  });
  it('closing stops pronunciation and releases the temporary interruption once', async () => {
    const t = setup(true); const pending = t.controller.play('audio'); t.controller.stop();
    expect(t.jobs[0].signal.aborted).toBe(true); expect(t.resume).toHaveBeenCalledTimes(1);
    t.jobs[0].finish(); await pending; expect(t.resume).toHaveBeenCalledTimes(1);
  });
  it('a failed pronunciation reports the failure and restores interrupted reading', async () => {
    const t = setup(true); const pending = t.controller.play('audio'); t.jobs[0].reject(); await pending;
    expect(t.failed).toHaveBeenCalledTimes(1); expect(t.resume).toHaveBeenCalledTimes(1);
  });
});
