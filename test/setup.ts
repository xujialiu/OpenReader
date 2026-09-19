import { afterEach, beforeEach } from 'vitest';

/**
 * Loaded by vitest before every test file (vitest.config.mts setupFiles), the
 * way the Zotero-TTS plugin's test/setup.ts is. That file installs the
 * plugin's en-US Fluent strings so a test asserts the sentence a user reads;
 * OwnReader has no strings yet, and when it does that belongs here too.
 *
 * What it does now is the one guarantee a provider suite needs from the
 * outside: **no test reaches the network.**
 *
 * Every provider takes `fetch` as an injected dependency — that is the
 * property ADR 0013 is built on and what makes 3,200 lines of provider tests
 * runnable under Node at all. A test that forgets to inject one would
 * otherwise fall through to Node's global `fetch` and quietly call a real
 * provider: slow, flaky, dependent on a key being in the environment, and
 * under ADR 0002 spending the owner's own money. The philosophy's rule 4 is
 * "no silent spending", and a test suite is not exempt.
 *
 * So the global is replaced with one that throws and names the caller's
 * mistake. A test that genuinely wants to exercise real network behaviour is
 * not a unit test and does not belong under test/.
 */
const forbidden: typeof fetch = (input) => {
  const target = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  return Promise.reject(
    new Error(
      `Tests must not reach the network; something called fetch(${JSON.stringify(target)}). ` +
        'Providers take fetch as an injected dependency — pass a fake one in.',
    ),
  );
};

let real: typeof globalThis.fetch | undefined;

beforeEach(() => {
  real = globalThis.fetch;
  globalThis.fetch = forbidden;
});

afterEach(() => {
  if (real) globalThis.fetch = real;
});
