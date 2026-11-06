/** All module paths in Metro's flat or indexed v3 source map. Never silently
 * omit a section: both licence notices and release-role isolation rely on it. */
export function bundleSources(map) {
  if (!map || map.version !== 3) throw new Error('Expected a version 3 bundle source map');
  if (Array.isArray(map.sources) && !('sections' in map) && map.sources.every((source) => typeof source === 'string')) {
    return map.sources;
  }
  if (Array.isArray(map.sections) && !('sources' in map)) {
    return map.sections.flatMap((section) => {
      if (!section?.map || section.url) throw new Error('Expected an embedded source map in every bundle section');
      return bundleSources(section.map);
    });
  }
  throw new Error('Expected bundle sources or indexed source-map sections');
}
