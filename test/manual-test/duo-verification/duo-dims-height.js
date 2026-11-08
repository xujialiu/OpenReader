/* global __r */
(() => {
  let dimensions;
  __r.getModules().forEach((module, id) => {
    if (module.verboseName && /\/Utilities\/Dimensions\.js$/.test(module.verboseName)) {
      const exported = __r(id);
      dimensions = exported.default || exported;
    }
  });
  if (!dimensions) throw Error('Dimensions module unavailable');
  return dimensions.get('window').height;
})()
