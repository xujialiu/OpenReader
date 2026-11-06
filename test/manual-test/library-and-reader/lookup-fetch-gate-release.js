(() => { const g = globalThis.__hopeGate; if (!g) return 'gate absent'; g.release(); return 'released'; })()
