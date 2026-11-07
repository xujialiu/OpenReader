// Issue #346: the DOM selection text of every displayed iframe, for the
// lookup-selection retention checks. Sent with the harness `js` command
// (hx.cjs appends `return probe();`, so the file must define `probe`).
/* global rendition */
// eslint-disable-next-line no-unused-vars
function probe() {
  const manager = rendition.manager;
  const out = [];
  manager.views._views.forEach((view) => {
    if (!(view.displayed && view.contents)) return;
    let selection = '';
    try { selection = view.contents.window.getSelection().toString(); } catch (e) { selection = `err: ${String(e).slice(0, 40)}`; }
    out.push({ section: view.section.index, selection: selection.slice(0, 80) });
  });
  return JSON.stringify({ frames: out });
}
