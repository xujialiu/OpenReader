import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { FlatList, NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
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
    restore: null as number | null, reader: null as DocumentId | null, suspended: false,
  });
  useLayoutEffect(() => { live.current.blocked = blocked; }, [blocked]);

  const restoreScroll = useCallback(() => {
    const now = live.current;
    if (now.restore !== null) list.current?.scrollToOffset({ offset: now.restore - now.inset, animated: false });
  }, []);
  const begin = useCallback(() => {
    const now = live.current;
    if (now.blocked || now.suspended || !navigation.isFocused()) return false;
    if (!now.active) {
      now.browseY = now.y;
      now.active = true;
      setState({ active: true, query: now.query });
    }
    return true;
  }, [navigation]);
  const cancel = useCallback(() => {
    const now = live.current;
    if (!now.active && !now.query) return;
    now.restore = now.browseY;
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
    now.restore = libraryQuery(text) ? 0 : now.browseY;
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
      if (now.suspended) now.restore = now.resultY;
      now.suspended = false; now.reader = null;
      bar.current?.setText(now.query);
      bar.current?.blur();
      restoreScroll();
    });
    return () => { unblur(); unstate(); unfocus(); };
  }, [exit, navigation, restoreScroll, routeKey]);

  // Restore after rows have committed, and again after native content sizes
  // change. Keep a pending target until it is observed, so a restore is not
  // lost when native clamps it against the old (shorter) result list.
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
      live.current.resultY = live.current.y;
      live.current.restore = null;
      live.current.suspended = true;
      bar.current?.blur();
    },
    onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const now = live.current;
      now.inset = event.nativeEvent.contentInset.top;
      if (now.suspended) return;
      now.y = Math.max(0, event.nativeEvent.contentOffset.y + now.inset);
      if (now.restore !== null && Math.abs(now.restore - now.y) < 1) now.restore = null;
    },
    onScrollBeginDrag: () => { live.current.restore = null; },
    onContentSizeChange: restoreScroll,
  };
}
