(() => { const g = globalThis.__hopeGate; if (!g) return 'gate absent'; return JSON.stringify({ installed: !!g.installed, count: g.count, waiting: g.waiting, aborted: g.aborted }); })()
