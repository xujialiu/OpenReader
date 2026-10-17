import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { pin } from '../structural';

/** Native code cannot execute in Vitest. Pin each terminal-state branch, not a
 * whole-file match that the other reader could satisfy. Device tests exercise
 * real URLSession failures before and during consumption (#203). */
const source = readFileSync('node_modules/expo/ios/Fetch/ExpoFetchModule.swift', 'utf8');
it('compiles the patched Expo pod instead of substituting an unpatched prebuilt framework', () => {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  expect(pkg.expo?.autolinking?.ios?.buildFromSource).toContain('expo');
});
function reader(name: string) {
  const start = `AsyncFunction("${name}") { (response: NativeResponse, promise: Promise) in`;
  pin(source, start, 'ExpoFetchModule');
  return source.slice(source.indexOf(start), source.indexOf('}.runOnQueue(fetchRequestQueue)', source.indexOf(start)));
}
function guarded(body: string) {
  pin(body, 'response.waitFor(states: [.bodyCompleted, .errorReceived]) { state in', 'buffered reader');
  pin(body, 'if state == .errorReceived {', 'buffered reader');
  pin(body, 'promise.reject(response.error ?? FetchUnknownException())', 'buffered reader');
  pin(body, 'return', 'buffered reader error branch');
}
for (const name of ['text', 'arrayBuffer']) describe(`Expo ${name}`, () => {
  it('settles on failure as well as completion, including a failure already received', () => guarded(reader(name)));
  it('does not let the other reader hide removal of this reader\'s error terminal state', () => {
    expect(() => guarded(reader(name).replace(', .errorReceived', ''))).toThrow();
  });
});
