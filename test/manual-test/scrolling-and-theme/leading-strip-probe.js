/*
 * The program leading-strip.sh hands the walkthrough harness's `js` for #35. It
 * runs in the reader's WebView, drives the reader's own highlighter
 * (`window.__openReaderHighlighter`) with the messages the bridge sends, and
 * returns at once: the highlighter's own requestAnimationFrame loop moves the
 * word, and the script photographs the screen afterwards. The script appends
 * the call, since the harness runs what it is given as a function's body.
 *
 * A fresh display of the chapter first, so that nothing a previous run left on
 * the screen is counted as this run's (README, Pitfalls). Then one 'speak' with
 * reveal, so the centring scrolls the sentence in as it does when a real Clip
 * starts; a word every 250 ms; and a 'hold' on the first word of the second line,
 * so that anything left above the first line's words is a strip of its own.
 */
/* global rendition */
// eslint-disable-next-line no-unused-vars
function leadingStripProbe(lineHeight) {
  const highlighter = window.__openReaderHighlighter;
  if (!highlighter) return 'no highlighter';
  const TARGET = 'She finished task after task and grew stronger, until one day the list gave her a task she was not sure she could finish.';
  const SKIP = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, TEMPLATE: 1, HEAD: 1, LINK: 1, META: 1, TITLE: 1, RT: 1, RP: 1 };

  function run() {
    const contents = rendition.getContents().filter((c) => c.sectionIndex === 0 && c.document && c.document.defaultView)[0];
    if (!contents) return;
    const win = contents.window;
    const doc = contents.document;
    if (lineHeight) doc.querySelector('p').style.lineHeight = lineHeight;

    // highlighter.ts's walk, so that the Block id is the one it reported.
    const found = [];
    let open = null;
    const close = () => {
      if (open && /\S/.test(open.text)) found.push(open);
      open = null;
    };
    const visit = (node, owner) => {
      if (node.nodeType === 3) {
        if (!node.data.length) return;
        if (!open) open = { element: owner, text: '', nodes: [] };
        open.nodes.push([node, open.text.length]);
        open.text += node.data;
        return;
      }
      if (node.nodeType !== 1 || SKIP[node.tagName.toUpperCase()]) return;
      const display = node.tagName.toUpperCase() === 'BR' ? 'inline' : String(win.getComputedStyle(node).display || '');
      if (display === 'none') return;
      if (display.startsWith('inline') || display === 'contents' || display.startsWith('ruby')) {
        for (const child of node.childNodes) visit(child, owner);
        return;
      }
      close();
      for (const child of node.childNodes) visit(child, node);
      close();
    };
    visit(doc.body, doc.body);
    close();

    const index = found.findIndex((block) => block.text.includes(TARGET));
    if (index < 0) return;
    const block = found[index];
    const id = '0.' + index;
    const at = block.text.indexOf(TARGET);
    // Where a Block offset is on the screen, to find the sentence's second line.
    const top = (offset) => {
      const [node, start] = block.nodes.filter(([, from]) => from <= offset).pop();
      const range = doc.createRange();
      range.setStart(node, offset - start);
      range.setEnd(node, offset - start + 1);
      return range.getBoundingClientRect().top;
    };

    const first = top(at);
    const words = [];
    let hold = -1;
    for (const match of TARGET.matchAll(/\S+/g)) {
      const word = match[0].replace(/[.,!?"]+$/, '');
      words.push({ atMs: words.length * 250, ranges: [{ block: id, start: at + match.index, end: at + match.index + word.length }] });
      if (hold < 0 && top(at + match.index) > first + 1) hold = words.length - 1;
    }
    highlighter({
      kind: 'speak',
      utterance: 999001,
      utteranceRanges: [{ block: id, start: at, end: at + TARGET.length, text: TARGET }],
      words,
      durationMs: words.length * 250,
      reveal: true,
    });
    setTimeout(() => highlighter({ kind: 'hold' }), hold * 250 + 125);
  }

  rendition.display(0).then(() => setTimeout(run, 800));
  return 'leading strip probe started';
}
