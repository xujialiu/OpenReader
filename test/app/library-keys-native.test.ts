import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { pin } from '../structural';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const swift = read('../../modules/open-reader-library-keys/ios/OpenReaderLibraryKeysModule.swift').replace(/\/\/[^\n]*/g, '');
const patch = read('../../patches/react-native-screens+4.26.2.patch');
const added = patch.split('\n').filter((line) => line.startsWith('+') && !line.startsWith('+++')).map((line) => line.slice(1)).join('\n');

// The key target is found by selector, so its two Objective-C names are the
// contract between the app's module and the navigation stack's patch (#339,
// ADR 0090). Neither side is compiled by Vitest; real keys are checked on iOS.
describe('Command-F and Escape on a Library page (#339)', () => {
  it('the app module answers the two selectors the patch looks for', () => {
    pin(swift, '@objc(openReaderLibraryKeys)', 'key target keys');
    pin(swift, '@objc(openReaderPerformLibraryKey:)', 'key target perform');
    pin(added, '- (NSArray<NSString *> *)openReaderLibraryKeys;', 'patch protocol keys');
    pin(added, '- (void)openReaderPerformLibraryKey:(NSString *)key;', 'patch protocol perform');
    pin(swift, '(find ? ["find"] : []) + (escape ? ["escape"] : [])', 'key names');
    pin(added, '[keys containsObject:@"find"]', 'patch find');
    pin(added, '[keys containsObject:@"escape"]', 'patch escape');
  });
  it('scopes the commands to the top page in a window with nothing presented, and steps aside for composed text', () => {
    pin(added, 'if (self.navigationController.topViewController != self || self.view.window == nil) {', 'top page');
    pin(added, 'if (page.presentedViewController != nil) {', 'nothing presented');
    pin(added, 'if (keys.count == 0 || [self openReaderComposingText]) {', 'composition');
    pin(added, 'if (target == nil || ![[target openReaderLibraryKeys] containsObject:key] || [self openReaderComposingText]) {', 'checked again when pressed');
    expect(added).not.toMatch(/sendEvent|RCTKeyCommands|method_exchangeImplementations/);
  });
  it('keeps nothing of the native search field in the patch, and #317’s back-button names', () => {
    expect(patch).not.toMatch(/RNSSearchBar|SearchBarNativeComponent|setContentScrollView|captureScrollPosition|hidesSearchBarWhenScrolling/);
    pin(added, '- (void)openReaderNameControllersBelowTop:(NSArray<UIViewController *> *)controllers', '#317');
  });
});
