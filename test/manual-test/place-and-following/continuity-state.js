(() => {
  const hook = globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__;
  if (!hook) return { ok: false, reason: 'React DevTools hook missing' };
  const players = [];
  const readings = [];
  const engines = [];
  const documents = [];
  const seen = new Set();
  const walk = (fiber) => {
    if (!fiber || seen.has(fiber)) return;
    seen.add(fiber);
    if (fiber.type && fiber.type.name === 'Player' && fiber.memoizedProps) {
      const props = fiber.memoizedProps;
      const notes = Array.isArray(props.notes) ? props.notes : [];
      players.push({
        collapsed: props.collapsed,
        playing: props.playing,
        buffering: props.buffering,
        noteCount: notes.length,
        waitingNote: notes.some((note) => String(note.said).includes('waiting for more of it')),
      });
    }
    if (fiber.type && fiber.type.name === 'ReadingView' && fiber.memoizedProps && fiber.memoizedProps.document) {
      const document = fiber.memoizedProps.document;
      documents.push({
        id: document.identity && document.identity.id,
        title: document.title,
      });
    }
    for (let state = fiber.memoizedState; state && typeof state === 'object'; state = state.next) {
      const value = state.memoizedState;
      if (value && typeof value === 'object' && Array.isArray(value.spineHrefs) && 'known' in value && 'utterance' in value) {
        readings.push({
          playing: value.playing,
          buffering: value.buffering,
          utterance: value.utterance,
          known: value.known,
          section: value.section,
          rendered: value.rendered,
          level: value.level,
          seeking: value.seeking,
          spineCount: value.spineHrefs.length,
          waitingNote: typeof value.note === 'string' && value.note.includes('waiting for more of it'),
        });
      }
      if (value && typeof value === 'object' && value.current && typeof value.current.snapshot === 'function') {
        try {
          const snapshot = value.current.snapshot();
          if (snapshot && typeof snapshot === 'object' && 'queued' in snapshot && 'fetching' in snapshot) {
            engines.push({
              playing: snapshot.playing,
              utterance: snapshot.utterance,
              rate: snapshot.rate,
              queued: snapshot.queued,
              fetching: snapshot.fetching,
              sameAsRemoteEventEngine: globalThis.__openreader291EngineMarker
                ? value.current === globalThis.__openreader291EngineMarker
                : null,
            });
          }
        } catch {
          // A ref can temporarily hold an engine that is being disposed.
        }
      }
    }
    walk(fiber.child);
    walk(fiber.sibling);
  };
  for (const renderer of hook.renderers.keys()) {
    for (const root of hook.getFiberRoots(renderer)) walk(root.current);
  }
  return { ok: players.length === 1 && readings.length === 1 && documents.length === 1, documents, players, readings, engines };
})()
