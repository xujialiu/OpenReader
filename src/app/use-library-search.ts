import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { FlatList, NativeScrollEvent, NativeSyntheticEvent, TextInput } from 'react-native';
import type { DocumentId } from '../core/document';
import type { ScreenProps } from './routes';
import { libraryQuery, type LibraryRow } from './library-search';

/**
 * One Library page's transient search (#332, #339, design 0090). Search exists
 * only between `start` (the Library actions' Search, or Command-F) and `exit`
 * (the close control, Escape, or leaving the page): the field is the page's
 * own and is drawn only while `active`. Neither the query nor a list position
 * goes into route parameters or storage. A result-to-Reader round trip is the
 * only navigation that keeps the search.
 *
 * List positions are the list's own, measured from the top of its content.
 * The list takes no inset from UIKit (`contentInsetAdjustmentBehavior` never,
 * ADR 0090): the title bar is opaque, and the room under the home indicator is
 * part of the content, so a restore reaches every offset a finger reaches.
 */
export function useLibrarySearch(navigation: ScreenProps<'Library' | 'Folder'>['navigation'], routeKey: string) {
  const [state, setState] = useState({ active: false, query: '' });
  const field = useRef<TextInput>(null);
  const list = useRef<Pick<FlatList<LibraryRow>, 'scrollToOffset'>>(null);
  const live = useRef({
    active: false, query: '', y: 0, inset: 0, browseY: 0, resultY: 0,
    restore: null as 'browse' | 'results' | 'top' | null, reader: null as DocumentId | null, suspended: false,
  });

  const target = () => {
    const now = live.current;
    return now.restore === 'browse' ? now.browseY : now.restore === 'results' ? now.resultY : 0;
  };
  const restoreScroll = useCallback(() => {
    if (live.current.restore === null) return;
    list.current?.scrollToOffset({ offset: target() - live.current.inset, animated: false });
  }, []);

  /** Opens search, whose field takes the keyboard as it appears; on a search already open, puts the cursor back in the field. */
  const start = useCallback(() => {
    const now = live.current;
    if (now.suspended || !navigation.isFocused()) return;
    if (now.active) { field.current?.focus(); return; }
    now.browseY = now.y;
    now.restore = null;
    now.active = true;
    setState({ active: true, query: now.query });
  }, [navigation]);
  /** Ends search: the query goes, the field and keyboard with it, and the list returns to where browsing was. */
  const exit = useCallback(() => {
    const now = live.current;
    if (!now.active && !now.query) return;
    now.restore = 'browse';
    now.active = false; now.query = ''; now.reader = null; now.suspended = false;
    setState({ active: false, query: '' });
  }, []);
  const change = useCallback((text: string) => {
    const now = live.current;
    if (!now.active || now.suspended || now.query === text) return;
    now.query = text;
    now.restore = libraryQuery(text) ? 'top' : 'browse';
    setState({ active: true, query: text });
  }, []);

  useEffect(() => {
    const leave = () => {
      const now = live.current;
      const stack = navigation.getState();
      const destination = stack.routes[stack.index];
      if (destination.key === routeKey) return;
      const params = destination.params;
      if (now.reader !== null && destination.name === 'Reader' && params && 'id' in params && params.id === now.reader) {
        now.suspended = true;
        field.current?.blur();
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
      restoreScroll();
    });
    return () => { unblur(); unstate(); unfocus(); };
  }, [exit, navigation, restoreScroll, routeKey]);

  // Restore after rows commit, and again when the content size changes after
  // that: the first request may still meet the old, shorter list.
  useLayoutEffect(() => {
    const frame = requestAnimationFrame(restoreScroll);
    return () => cancelAnimationFrame(frame);
  }, [state, restoreScroll]);

  return {
    ...state, start, exit, change, field,
    blur: () => field.current?.blur(),
    attachList: (node: Pick<FlatList<LibraryRow>, 'scrollToOffset'> | null) => { list.current = node; },
    /** Called immediately before navigating, never for imports or the Reading Button. */
    openingResult: (id: DocumentId) => {
      const now = live.current;
      if (!now.active || !libraryQuery(now.query)) return;
      now.reader = id;
      now.resultY = now.y;
      now.restore = null;
      now.suspended = true;
      field.current?.blur();
    },
    onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const now = live.current;
      // The Reader's transition may move the list behind it; that is not where the results were left.
      if (now.suspended) return;
      now.inset = event.nativeEvent.contentInset.top;
      now.y = Math.max(0, event.nativeEvent.contentOffset.y + now.inset);
      if (now.restore !== null && Math.abs(target() - now.y) < 1) now.restore = null;
    },
    onScrollBeginDrag: () => { live.current.restore = null; },
    onContentSizeChange: restoreScroll,
  };
}
