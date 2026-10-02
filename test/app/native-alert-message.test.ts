import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/** Installation contract only. Actual message visibility is a required simulator check, not proved by source assertions. */
describe('Expo alert direct-text patch (#121)', () => {
  it('keeps the public prop, native field and direct SwiftUI Text in the installed package', () => {
    const read = (path: string) => readFileSync(new URL(`../../node_modules/@expo/ui/${path}`, import.meta.url), 'utf8');
    expect(read('src/swift-ui/Alert/index.tsx')).toContain('message?: string;');
    expect(read('build/swift-ui/Alert/index.d.ts')).toContain('message?: string;');
    expect(read('ios/Alert/AlertProps.swift')).toContain('@Field var message: String?');
    expect(read('ios/Alert/Alert.swift')).toMatch(/if let message = props\.message\s*\{[\s\S]*?Text\(message\)/);
  });
});
