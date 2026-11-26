(() => {
  const hook = globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__;
  const module = globalThis.expo && globalThis.expo.modules && globalThis.expo.modules.OpenReaderNowPlaying;
  if (!hook || !module) return { delivered: false, reason: 'Player or Now Playing module missing' };
  const players = [];
  const engines = [];
  const engineRefs = [];
  const seen = new Set();
  const walk = (fiber) => {
    if (!fiber || seen.has(fiber)) return;
    seen.add(fiber);
    if (fiber.type && fiber.type.name === 'Player' && fiber.memoizedProps) {
      const p = fiber.memoizedProps;
      players.push({ playing: p.playing, buffering: p.buffering, collapsed: p.collapsed });
    }
    for (let state = fiber.memoizedState; state && typeof state === 'object'; state = state.next) {
      const value = state.memoizedState;
      if (value && typeof value === 'object' && value.current && typeof value.current.snapshot === 'function') {
        try {
          const snapshot = value.current.snapshot();
          if (snapshot && typeof snapshot === 'object' && 'queued' in snapshot && 'fetching' in snapshot) {
            engines.push({ playing: snapshot.playing, utterance: snapshot.utterance, queued: snapshot.queued, fetching: snapshot.fetching });
            if (snapshot.playing === true && snapshot.queued > 0) engineRefs.push(value.current);
          }
        } catch {
          // Ignore a ref whose engine is being disposed.
        }
      }
    }
    walk(fiber.child);
    walk(fiber.sibling);
  };
  for (const renderer of hook.renderers.keys()) {
    for (const root of hook.getFiberRoots(renderer)) walk(root.current);
  }
  const listeners = typeof module.listenerCount === 'function' ? module.listenerCount('remoteCommand') : null;
  if (players.length !== 1 || players[0].playing !== true ||
      engineRefs.length === 0 ||
      listeners !== 1 || typeof module.emit !== 'function') {
    return { delivered: false, reason: 'precondition failed', players, engines, listeners, canEmit: typeof module.emit === 'function' };
  }
  globalThis.__openreader291EngineMarker = engineRefs[0];
  module.emit('remoteCommand', { command: 'play' });
  const currentEngines = [];
  const inspect = (fiber, visited = new Set()) => {
    if (!fiber || visited.has(fiber)) return;
    visited.add(fiber);
    for (let state = fiber.memoizedState; state && typeof state === 'object'; state = state.next) {
      const value = state.memoizedState;
      if (value && typeof value === 'object' && value.current && typeof value.current.snapshot === 'function') {
        try {
          const snapshot = value.current.snapshot();
          if (snapshot && typeof snapshot === 'object' && 'queued' in snapshot && 'fetching' in snapshot) {
            currentEngines.push(value.current);
          }
        } catch {
          // Ignore a ref whose engine is being disposed.
        }
      }
    }
    inspect(fiber.child, visited);
    inspect(fiber.sibling, visited);
  };
  for (const renderer of hook.renderers.keys()) {
    for (const root of hook.getFiberRoots(renderer)) inspect(root.current);
  }
  return {
    delivered: true,
    event: 'remoteCommand',
    command: 'play',
    listenerCount: listeners,
    players,
    engines,
    sameEngineAfterEvent: currentEngines.some((engine) => engine === engineRefs[0]),
  };
})()
