/* global rendition */
// First call remembers the upper viewport CFI. Later calls measure that SAME
// character in the new frames; never recapture the post-resize start as proof.
// Reset with a harness js command: delete window.__openReaderResizeProbe;
// Read-only apart from this probe's own window property. Sends no app command.
// eslint-disable-next-line no-unused-vars
function probe() {
  const manager = rendition.manager;
  const stage = manager.container;
  if (!window.__openReaderResizeProbe) {
    const location = rendition.located(manager.scrolledLocation());
    if (!location.start) return 'No visible CFI to capture';
    window.__openReaderResizeProbe = { cfi: location.start.cfi, section: location.start.index };
  }
  const anchor = window.__openReaderResizeProbe;
  const contents = rendition.getContents().find((one) => one.sectionIndex === anchor.section);
  if (!contents) return JSON.stringify({ ...anchor, onPage: false });
  const range = contents.range(anchor.cfi);
  range.collapse(true);
  if (range.startContainer.nodeType === 3 && range.startOffset < range.startContainer.length) {
    range.setEnd(range.startContainer, range.startOffset + 1);
  }
  const rect = range.getBoundingClientRect();
  const frame = contents.document.defaultView.frameElement.getBoundingClientRect();
  return JSON.stringify({
    ...anchor, onPage: true,
    top: frame.top + rect.top - stage.getBoundingClientRect().top,
    lineHeight: rect.height, viewportHeight: stage.clientHeight, viewportWidth: stage.clientWidth,
  });
}
