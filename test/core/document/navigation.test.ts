import { expect, it } from 'vitest';
import { readDocumentNavigation } from '../../../src/core/document/navigation';
import { navigationPlan, withPreparedSection, fullyPrepared, descendants } from '../../../src/offline/model';
import { bytesAsArchive, readZipDirectory } from '../../../src/core/document/zip';
import { zip, utf8 } from './zip-fixture';

const container = '<container><rootfiles><rootfile full-path="OPS/package.opf"/></rootfiles></container>';
function fixture(nav: string, ncx = false) {
  return zip([
    { name: 'META-INF/container.xml', data: utf8(container) },
    { name: 'OPS/package.opf', data: utf8(`<package><manifest>
      <item id="nav" href="nav/${ncx ? 'toc.ncx' : 'nav.xhtml'}" ${ncx ? 'media-type="application/x-dtbncx+xml"' : 'properties="nav"'}/>
      <item id="one" href="text/one.xhtml"/><item id="two" href="text/two.xhtml"/>
      </manifest><spine toc="nav"><itemref idref="one"/><itemref idref="two"/></spine></package>`) },
    { name: `OPS/nav/${ncx ? 'toc.ncx' : 'nav.xhtml'}`, data: utf8(nav) },
    { name: 'OPS/text/one.xhtml', data: utf8('<html><body>BODY MUST NOT BE READ</body></html>') },
    { name: 'OPS/text/two.xhtml', data: utf8('<html><body>Unlisted body</body></html>') },
  ], { level: 6 });
}
it('reads nested EPUB3 names and fragments without inflating or reading chapter bodies', () => {
  const bytes = fixture('<html xmlns:e="http://www.idpf.org/2007/ops"><body><nav e:type="toc"><ol><li><span>Volume</span><ol><li><a href="../text/one.xhtml#first">First</a></li><li><a href="../text/one.xhtml#second">Second</a></li></ol></li></ol></nav></body></html>');
  const base = bytesAsArchive(bytes);
  const bodies = readZipDirectory(base).filter((m) => new TextDecoder().decode(m.name).includes('/text/'));
  const navigation = readDocumentNavigation({ size: base.size, read: (offset, length) => {
    // ZIP-directory tail reads may span the file but member reads must never
    // target either content member's local header or compressed payload.
    for (const member of bodies) expect(offset === member.offset).toBe(false);
    return base.read(offset, length);
  } });
  expect(navigation.chapters.map((c) => [c.id, c.title, c.section, c.fragment, c.parent])).toEqual([
    ['nav.0', 'Volume', null, '', null], ['nav.0.0', 'First', 0, 'first', 'nav.0'], ['nav.0.1', 'Second', 0, 'second', 'nav.0'],
  ]);
  const plan = navigationPlan(navigation);
  expect(plan.chapters.filter((c) => c.prepared === false).map((c) => c.id)).toEqual(['section-0', 'nav.0.0', 'nav.0.1', 'section-1']);
  expect(descendants(plan.chapters, 'nav.0').map((c) => c.id)).toEqual(['nav.0.0', 'nav.0.1']);
  expect(fullyPrepared(plan)).toBe(false);
  const prepared = withPreparedSection(plan, 0, [{ id: 'nav.0.0', title: 'First', depth: 1, parent: 'nav.0', texts: ['Hello.'] }]);
  expect(prepared.chapters.find((c) => c.id === 'section-1')?.prepared).toBe(false);
  expect(fullyPrepared(prepared)).toBe(false);
  expect(fullyPrepared(withPreparedSection(prepared, 1, []))).toBe(true);
});
it('reads EPUB2 NCX navigation in its own directory, including a standard external DOCTYPE without fetching it', () => {
  const bytes = fixture('<!DOCTYPE ncx PUBLIC "-//NISO//DTD ncx 2005-1//EN" "http://www.daisy.org/z3986/2005/ncx-2005-1.dtd"><ncx><navMap><navPoint><navLabel><text>Chapter One</text></navLabel><content src="../text/one.xhtml"/></navPoint></navMap></ncx>', true);
  const result = readDocumentNavigation(bytesAsArchive(bytes));
  expect(result.chapters[0]).toMatchObject({ id: 'nav.0', title: 'Chapter One', section: 0, fragment: '' });
  expect(navigationPlan(result).chapters.map((c) => c.id)).toEqual(['nav.0', 'section-1']);
});
it('offers a thousands-of-chapters catalogue without inspecting its body files', () => {
  const count = 2200;
  const items = Array.from({ length: count }, (_, i) => `<item id="c${i}" href="c${i}.xhtml"/>`).join('');
  const refs = Array.from({ length: count }, (_, i) => `<itemref idref="c${i}"/>`).join('');
  const links = Array.from({ length: count }, (_, i) => `<li><a href="c${i}.xhtml">Chapter ${i + 1}</a></li>`).join('');
  // Body members are deliberately absent: metadata discovery must not ask for them.
  const bytes = zip([
    { name: 'META-INF/container.xml', data: utf8(container) },
    { name: 'OPS/package.opf', data: utf8(`<package><manifest><item id="nav" href="nav.xhtml" properties="nav"/>${items}</manifest><spine>${refs}</spine></package>`) },
    { name: 'OPS/nav.xhtml', data: utf8(`<html xmlns:epub="http://www.idpf.org/2007/ops"><nav epub:type="toc"><ol>${links}</ol></nav></html>`) },
  ], { level: 6 });
  const plan = navigationPlan(readDocumentNavigation(bytesAsArchive(bytes)));
  expect(plan.chapters).toHaveLength(count);
  expect(plan.chapters[2099]).toMatchObject({ title: 'Chapter 2100', section: 2099, prepared: false, texts: [] });
});
