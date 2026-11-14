import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../manual-test/kit/FishKeyEntryProbe.swift', import.meta.url), 'utf8');
const code = source.replace(/\/\/[^\n]*/g, '');
const guide = readFileSync(new URL('../manual-test/duo-verification/fish-key-entry.md', import.meta.url), 'utf8');
const runner = readFileSync(new URL('../manual-test/duo-verification/fish-classifier-red-green.sh', import.meta.url), 'utf8');
const publicMethod = code.slice(code.indexOf('func testPublicSentinelIntoEmptyAndClearOwn()'),
  code.indexOf('func testPrivateInputIntoEmpty()'));
const realMethod = code.slice(code.indexOf('func testPrivateInputIntoEmpty()'));
const classifierBlock = source.slice(source.indexOf('HOST-TESTABLE CLASSIFIER'),
  source.indexOf('HOST-TESTABLE CLASSIFIER — exact block end'));
const classifierCode = classifierBlock.replace(/\/\/[^\n]*/g, '');
const attemptPath = '/tmp/openreader-fish-key-entry-duo-8437-attempt-02';

// HOST source contracts only: these do not compile Swift (the host runner
// fish-classifier-red-green.sh compiles the exact classifier block), exercise
// XCTest or establish framework logging privacy, persistence or credential
// validity.
describe('FishKeyEntryProbe HOST source contract', () => {
  it('only attaches to the already-foreground app and performs field taps/typing', () => {
    expect(code).toContain('app.wait(for: .runningForeground, timeout: 3)');
    expect(code).not.toMatch(/\.(launch|terminate|activate|press|swipe\w*)\(/);
    expect(code.match(/\w+\.tap\(\)/g)).toEqual(['field.tap()', 'field.tap()']);
    expect(code.match(/\w+\.typeText\(/g)).toHaveLength(3);
    expect(code).not.toMatch(/app\.buttons|URLSession|SecItem|UIPasteboard|ProcessInfo/);
  });

  it('requires the disabled Fish screen and exactly one masked editable API key field', () => {
    expect(code).toContain('app.switches.matching(identifier: "Enable Fish Audio")');
    expect(code).toContain('switches.count == 1');
    expect(code).toContain('enabled.isEnabled && (enabled.value as? String) == "0"');
    expect(code).toContain('app.textFields.matching(identifier: "API key").count == 0');
    expect(code).toContain('app.secureTextFields.matching(identifier: "API key")');
    expect(code).toContain('fields.count == 1');
    expect(code).toContain('field.isEnabled && field.isHittable');
    expect(code).toContain('field.placeholderValue == "Not set"');
  });

  it('stops on a normal API key error footnote before any input', () => {
    expect(code).toContain('label BEGINSWITH');
    expect(code).toContain('"API key error footnote present"');
  });

  it('checks the dedicated private directory/file and bounded input before typing', () => {
    expect(code).toContain(`private let attemptPath = "${attemptPath}"`);
    expect(code).not.toContain('attempt-01');
    expect(guide).toContain(`ATTEMPT=${attemptPath}`);
    expect(guide).toContain('attempt-01');
    expect(code).toContain('parent[.type] as? FileAttributeType == .typeDirectory');
    expect(code).toContain('file[.type] as? FileAttributeType == .typeRegular');
    expect(code).toContain('parent[.posixPermissions] as? NSNumber)?.intValue == 0o700');
    expect(code).toContain('file[.posixPermissions] as? NSNumber)?.intValue == 0o600');
    expect(code).toContain('file[.referenceCount] as? NSNumber)?.intValue == 1');
    expect(code).toContain('input.utf8.count <= 512');
    expect(code).toContain('!input.isEmpty');
    expect(code).toContain('(33...126).contains(Int($0.value))');
  });

  it('classifies one accessibility read: nil/non-String unavailable, empty and legacy placeholder empty, else nonempty', () => {
    expect(classifierBlock).toContain('HOST-TESTABLE CLASSIFIER');
    expect(classifierCode).toContain('enum FishKeyEntryFieldRead: Equatable');
    expect(classifierCode).toContain('case empty');
    expect(classifierCode).toContain('case nonempty');
    expect(classifierCode).toContain('case unavailable');
    expect(classifierCode).toContain('func classifyFishKeyEntryFieldValue(_ raw: Any?) -> FishKeyEntryFieldRead');
    expect(classifierCode).toContain('guard let text = raw as? String else { return .unavailable }');
    expect(classifierCode).toContain('text.isEmpty || text == "Not set" ? .empty : .nonempty');
    expect(classifierCode).not.toMatch(/XCTest|XCUI|import |print\(/);
  });

  it('routes every field read through the classifier and fails closed before input', () => {
    expect(code.match(/field\.value/g)).toHaveLength(1);
    expect(code).toContain('let read = classifyFishKeyEntryFieldValue(field.value)');
    expect(code).toContain('guard read != .unavailable else');
    expect(code).toContain('try require(false, "Secure API key state is unavailable")');
    expect(code).not.toContain('guard let value = field.value as? String, !value.isEmpty');
    expect(code).not.toContain('private func isEmpty');
    expect(code).toContain('private func requireEmpty(');
    expect(code).toContain('private func requireContent(');
    expect(code).toContain('guard read == .empty else');
    expect(code).toContain('guard read == .nonempty else');
  });

  it('clears only its own public sentinel, from empty, by its known public length', () => {
    const sentinel = source.match(/private let publicSentinel = "([^"]+)"/)?.[1];
    expect(sentinel).toBe('OPENREADER_PUBLIC_FISH_SENTINEL_8437');
    expect(sentinel).toHaveLength(36);
    expect(publicMethod).toContain('requireMode("public-sentinel-originally-absent")');
    expect(publicMethod).toContain('require(input == publicSentinel, "Public sentinel input required")');
    expect(publicMethod.indexOf('requireEmpty(field, "Empty secure API key field required")')).toBeLessThan(publicMethod.indexOf('field.tap()'));
    expect(publicMethod).toContain('String(repeating: XCUIKeyboardKey.delete.rawValue, count: publicSentinel.count)');
    expect(publicMethod).toContain('requireEmpty(field, "Own public sentinel did not clear to the placeholder")');
    expect(publicMethod).not.toMatch(/field\.value|value.*count|Clear text/);
  });

  it('requires an explicit qualified real mode and empty field, without a real-key clear path', () => {
    expect(realMethod).toContain('requireMode("real-input-privacy-qualified")');
    expect(realMethod).toContain('require(input != publicSentinel');
    expect(realMethod.indexOf('requireEmpty(field, "Empty secure API key field required")')).toBeLessThan(realMethod.indexOf('field.typeText(input)'));
    expect(realMethod).not.toMatch(/delete|repeating|Clear text/);
    expect(realMethod).toContain('requireContent(field, "Private input entry was not observed")');
  });

  it('keeps source assertions fixed and field values out of explicit output/captures', () => {
    expect(code).toContain('continueAfterFailure = false');
    expect(code).toContain('XCTFail(message)');
    expect(code).not.toMatch(/print\(|debugDescription|screenshot|XCTAttachment|XCTAssert|\\\(/);
    expect([...code.matchAll(/try require\([\s\S]*?,\s*("[^"\n]*")\)/g)].length).toBeGreaterThan(15);
  });

  it('documents the repaired status, the renewed staging exception and the same privacy limits', () => {
    for (const text of ['HOST-repaired', 'NOT NATIVE QUALIFIED', 'attempt-01', attemptPath,
      'UTF-16 LE/BE', 'hex and base64', 'complete\nreadable xcresult text/JSON',
      'STOP: do not load or type the real credential', 'ONE public attempt', 'ONE real attempt',
      'loadSettings()', 'only this shell\'s staged `fish-api-key.txt`', 'presence/resave/connection-check',
      'one bounded foreground `ios_guard.py` admission', 'Xcode-27.1.0.app', '**8437**',
      'api.fish.audio/compat/v1/models', 'one keyless GET', 'FishKeyEntryFieldRead',
      'unknown, held and refused are not absence']) {
      expect(guide).toContain(text);
    }
    expect(guide).not.toContain('NOT COMPILED, NOT NATIVE, NOT PRIVACY QUALIFIED');
  });

  it('keeps the host red/green runner compiling the exact classifier without device operations', () => {
    expect(runner).toContain('/usr/bin/swiftc');
    expect(runner).toContain('HOST-TESTABLE CLASSIFIER');
    expect(runner).toContain('exact block begin');
    expect(runner).toContain('FISH_CLASSIFIER_OLD_REF:-2e56559');
    expect(runner).toContain('mktemp');
    expect(runner).toContain('guard let value = field.value as? String, !value.isEmpty else');
    expect(runner).not.toMatch(/xcrun|simctl|git checkout|git apply|git restore|metro|Metro/);
  });
});
