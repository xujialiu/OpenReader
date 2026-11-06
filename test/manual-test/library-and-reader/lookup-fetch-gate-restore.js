(() => { const g = globalThis.__hopeGate; if (!g) return 'gate absent'; g.restore(); return 'restored'; })()
