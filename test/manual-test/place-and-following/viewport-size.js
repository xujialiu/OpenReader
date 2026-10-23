/* global rendition */
// Read-only geometry, not a synthetic resize. Send with hx.cjs '{}' --code-file.
// eslint-disable-next-line no-unused-vars
function probe() {
  const manager = rendition.manager;
  const container = manager.stage.container;
  return JSON.stringify({
    viewport: { width: window.innerWidth, height: window.innerHeight },
    stage: { width: container.clientWidth, height: container.clientHeight },
    recordedStage: manager._stageSize,
    views: manager.views.all().filter(function (view) { return view.displayed; }).map(function (view) {
      return { section: view.section.index, width: view.iframe.clientWidth, height: view.iframe.clientHeight };
    }),
  });
}
