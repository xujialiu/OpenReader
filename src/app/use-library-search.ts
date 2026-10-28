import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Platform, type FlatList, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import type { SearchBarCommands, SearchBarProps } from 'react-native-screens';
import type { DocumentId } from '../core/document';
import type { ScreenProps } from './routes';
import { libraryQuery, type LibraryRow } from './library-search';

/**
 * One Library page's transient search. Neither query nor scroll positions go
 * into route params or storage. The native field owns focus; blur alone is
 * not cancellation. A result-to-Reader round trip is the only navigation
 * that keeps the search (#332, design 0090).
 */
export function useLibrarySearch(
  navigation: ScreenProps<'Library' | 'Folder'>['navigation'], routeKey: string, blocked: boolean,
  { tintColor, textColor }: Pick<SearchBarProps, 'tintColor' | 'textColor'> = {},
) {
  const [state, setState] = useState({ active: false, query: '' });
  const bar = useRef<SearchBarCommands>(null);
  const list = useRef<Pick<FlatList<LibraryRow>, 'scrollToOffset'>>(null);
  const live = useRef({
    active: false, query: '', blocked, y: 0, inset: 0, browseY: 0, resultY: 0,
    restore: null as 'browse' | 'results' | 'top' | null, reader: null as DocumentId | null, suspended: false,
  });
  useLayoutEffect(() => { live.current.blocked = blocked; }, [blocked]);

  const restoreScroll = useCallback(() => {
    const now = live.current;
    if (now.restore === null) return;
    if (Platform.OS === 'ios') {
      bar.current?.restoreScrollPosition(now.restore);
    } else {
      const position = now.restore === 'browse' ? now.browseY : now.restore === 'results' ? now.resultY : 0;
      list.current?.scrollToOffset({ offset: position - now.inset, animated: false });
    }
  }, []);
  const begin = useCallback(() => {
    const now = live.current;
    if (now.blocked || now.suspended || !navigation.isFocused()) return false;
    if (!now.active) {
      // Capture before focus changes the native header/insets or rows change.
      if (Platform.OS === 'ios') bar.current?.captureScrollPosition('browse');
      else now.browseY = now.y;
      now.restore = null;
      now.active = true;
      setState({ active: true, query: now.query });
    }
    return true;
  }, [navigation]);
  const cancel = useCallback(() => {
    const now = live.current;
    if (!now.active && !now.query) return;
    now.restore = 'browse';
    now.active = false; now.query = ''; now.reader = null; now.suspended = false;
    setState({ active: false, query: '' });
  }, []);
  const exit = useCallback(() => {
    cancel();
    // cancelSearch emits both Cancel and an empty change event. Neither may
    // start a new search after the local state has been cleared.
    bar.current?.cancelSearch();
  }, [cancel]);
  const start = useCallback(() => {
    if (begin()) bar.current?.focus();
  }, [begin]);
  const change = useCallback((text: string) => {
    const now = live.current;
    if (now.suspended || now.blocked || !navigation.isFocused()) return;
    if (!now.active && !text) return;
    if (!begin()) return;
    if (now.query === text) return;
    now.query = text;
    now.restore = libraryQuery(text) ? 'top' : 'browse';
    setState({ active: true, query: text });
  }, [begin, navigation]);

  useEffect(() => {
    const leave = () => {
      const now = live.current;
      const stack = navigation.getState();
      const destination = stack.routes[stack.index];
      if (destination.key === routeKey) return;
      const params = destination.params;
      if (now.reader !== null && destination.name === 'Reader' && params && 'id' in params && params.id === now.reader) {
        now.suspended = true;
        bar.current?.blur();
      } else {
        exit();
      }
    };
    const unblur = navigation.addListener('blur', leave);
    const unstate = navigation.addListener('state', leave);
    const unfocus = navigation.addListener('focus', () => {
      const now = live.current;
      if (now.suspended) now.restore = 'results';
      now.suspended = false; now.reader = null;
      bar.current?.setText(now.query);
      bar.current?.blur();
      restoreScroll();
    });
    return () => { unblur(); unstate(); unfocus(); };
  }, [exit, navigation, restoreScroll, routeKey]);

  // Restore after rows commit and again if native content size changes after
  // that request. A short result list may still be laid out at the first call.
  // On iOS retain the semantic request until the next drag/search action: only
  // UIKit knows its adjusted inset; RN's event reports the explicit inset.
  useLayoutEffect(() => {
    const frame = requestAnimationFrame(restoreScroll);
    return () => cancelAnimationFrame(frame);
  }, [state, restoreScroll]);

  const options = useMemo<SearchBarProps>(() => ({
    ref: bar, placeholder: 'Search Library', placement: 'stacked', allowToolbarIntegration: false, tintColor, textColor,
    hideWhenScrolling: !state.active, hideNavigationBar: false, obscureBackground: false, autoCapitalize: 'none',
    onFocus: () => { begin(); },
    onChangeText: (event) => change(event.nativeEvent.text),
    onCancelButtonPress: () => {
      if (!live.current.suspended && navigation.isFocused()) cancel();
    },
    onSearchButtonPress: () => bar.current?.blur(),
  }), [begin, cancel, change, navigation, state.active, textColor, tintColor]);
  useLayoutEffect(() => {
    navigation.setOptions({ headerSearchBarOptions: blocked ? undefined : options });
  }, [blocked, navigation, options]);

  return {
    ...state, start, exit,
    attachList: (node: Pick<FlatList<LibraryRow>, 'scrollToOffset'> | null) => { list.current = node; },
    /** Called immediately before navigating, never for imports or the Reading Button. */
    openingResult: (id: DocumentId) => {
      if (!live.current.active || !libraryQuery(live.current.query)) return;
      live.current.reader = id;
      if (Platform.OS === 'ios') bar.current?.captureScrollPosition('results');
      else live.current.resultY = live.current.y;
      live.current.restore = null;
      live.current.suspended = true;
      bar.current?.blur();
    },
    onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      // The iOS event says contentInset.top=0 even when UIKit adds 116 pt.
      // Neither its raw offset nor its explicit inset owns our saved position.
      if (Platform.OS === 'ios') return;
      const now = live.current;
      now.inset = event.nativeEvent.contentInset.top;
      if (now.suspended) return;
      now.y = Math.max(0, event.nativeEvent.contentOffset.y + now.inset);
      const expected = now.restore === 'browse' ? now.browseY : now.restore === 'results' ? now.resultY : 0;
      if (now.restore !== null && Math.abs(expected - now.y) < 1) now.restore = null;
    },
    onScrollBeginDrag: () => { live.current.restore = null; },
    onContentSizeChange: restoreScroll,
  };
}
