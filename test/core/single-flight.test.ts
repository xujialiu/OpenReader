import { describe, expect, it } from 'vitest';
import { createSingleFlight } from '../../src/core/single-flight';

/** A run that ends only when its gate is opened. */
function harness() {
  const runs: { trigger: string; force: boolean; done: () => void }[] = [];
  const flight = createSingleFlight(
    (trigger, force) =>
      new Promise<void>((done) => {
        runs.push({ trigger, force, done });
      }),
  );
  return { runs, flight };
}

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('createSingleFlight', () => {
  it('runs a poke at once and reports running until it ends', async () => {
    const { runs, flight } = harness();
    expect(flight.running()).toBe(false);
    flight.poke('startup');
    expect(runs.map((r) => r.trigger)).toEqual(['startup']);
    expect(runs[0].force).toBe(false);
    expect(flight.running()).toBe(true);
    runs[0].done();
    await settle();
    expect(flight.running()).toBe(false);
  });

  it('folds a burst of pokes into the running one plus one trailing run, named after the last', async () => {
    const { runs, flight } = harness();
    flight.poke('reader-open');
    flight.poke('reader-open');
    flight.poke('reader-close');
    flight.poke('pane-open');
    expect(runs).toHaveLength(1);
    runs[0].done();
    await settle();
    expect(runs.map((r) => r.trigger)).toEqual(['reader-open', 'pane-open']);
    runs[1].done();
    await settle();
    expect(runs).toHaveLength(2);
    expect(flight.running()).toBe(false);
  });

  it('a flush behind a running run forces the trailing one and resolves when it has ended', async () => {
    const { runs, flight } = harness();
    flight.poke('reader-open');
    let flushed = false;
    const flush = flight.flush('shutdown').then(() => {
      flushed = true;
    });
    flight.poke('reader-close');
    runs[0].done();
    await settle();
    expect(runs.map((r) => [r.trigger, r.force])).toEqual([
      ['reader-open', false],
      ['reader-close', true],
    ]);
    expect(flushed).toBe(false);
    runs[1].done();
    await flush;
    expect(flushed).toBe(true);
  });

  it('a flush with nothing in flight runs at once, forced', async () => {
    const { runs, flight } = harness();
    const flush = flight.flush('switch-on');
    expect(runs.map((r) => [r.trigger, r.force])).toEqual([['switch-on', true]]);
    runs[0].done();
    await flush;
  });

  it('resolves each flush with what the run it waited for returned, whatever runs after it (#54)', async () => {
    // The trailing run starts inside the finished run's own cleanup, before the
    // first flush's caller resumes; an answer read from anything shared would
    // then be the trailing run's, which has not answered yet.
    const runs: { trigger: string; done: (said: string) => void }[] = [];
    const flight = createSingleFlight(
      (trigger) =>
        new Promise<string>((done) => {
          runs.push({ trigger, done });
        }),
    );
    const play = flight.flush('play');
    flight.poke('foreground');
    const open = flight.flush('open');
    runs[0].done('what play found');
    expect(await play).toBe('what play found');
    expect(runs.map((r) => r.trigger)).toEqual(['play', 'open']);
    // The flush that joined the trailing run is answered by that run.
    runs[1].done('what the trailing run found');
    expect(await open).toBe('what the trailing run found');
  });
});
