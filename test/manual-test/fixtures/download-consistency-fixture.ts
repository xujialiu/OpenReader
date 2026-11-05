/**
 * Six small public-text books for the Download-consistency batch's native
 * verification (#253, #171, #277, #172, #278). Every sentence is unique
 * across all books, so no Utterance of one download can be answered by a
 * saved Clip of another (the shared-sentence case is unit-tested, not staged
 * here by accident).
 *
 * - `Download Consistency Fixture` — chapters one/two/three (3 sentences
 *   each) and four (5 sentences), for the pause-held-final-replies check
 *   (#171): four is the last chapter written, and its tail is where Pause all
 *   lands while replies are out.
 * - `Manage Delete Fixture` — alpha/gamma (3 sentences each) and beta
 *   (5 sentences), for Delete selected on a partly saved paused chapter
 *   (#277): beta is the chapter paused mid-write.
 * - `Empty Parts Fixture` — an empty cover page and one chapter, for the
 *   Live Activity count's empty-part exclusion (#172, `1 of 1`).
 * - `Only Cover Fixture` — two empty pages, for the all-empty batch (#172,
 *   `0 of 0`, no Downloaded check anywhere).
 * - `Bracket Fixture` — one chapter holding a `<Seven eta>.` sentence plus
 *   two plain ones, for the completed line after a bracket-setting change
 *   (#278).
 * - `Solo Fixture` — one 3-sentence chapter, for the blocked-reason and
 *   explicit-Resume recovery (#253).
 * - `Pause Control Fixture` — chapters c1 (3 sentences) and c2 (5 sentences),
 *   for the control pause of #171: Pause all while c2 still has unsent
 *   sentences, which must stay paused over its saved part, and Resume all
 *   then fetches only what is missing.
 *
 * The empty pages follow `issue86-fixture.ts`'s text-less volume page: a
 * hidden heading and a non-breaking space, which the renderer collects as no
 * speakable text.
 *
 *     npx tsx test/manual-test/fixtures/download-consistency-fixture.ts OUTPUT_DIRECTORY
 *
 * Writes one EPUB per book. The ZIP is `test/core/document/zip-fixture.ts`'s,
 * stored. Every run stamps a fresh `dcterms:modified`, so every run gets a
 * new content hash and a fresh Library id with no prior download state.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { utf8, zip } from '../../core/document/zip-fixture';

const EMPTY_PAGE = (title: string) => `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>${title}</title></head>
<body>
  <h1 style="display:none">${title}</h1>
  <p>&#160;</p>
</body>
</html>
`;

const chapter = (title: string, sentences: readonly string[]) => `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>${title}</title></head>
<body>
<h1>${title}</h1>
${sentences.map((sentence) => `<p>${sentence}</p>`).join('\n')}
</body>
</html>
`;

interface Book {
  file: string;
  title: string;
  uid: string;
  /** Spine entries: `{ id, empty }` — an empty entry is a text-less page. */
  spine: readonly { id: string; title: string; empty?: boolean; sentences?: readonly string[] }[];
}

const ONE = [
  'The ferry left the harbour before the market stalls were packed away.',
  'A boy counted the gulls from the stern and named the loud ones.',
  'By the third bell the island had slid behind a sheet of rain.',
];
const TWO = [
  'The baker scored every loaf twice, once for the crust and once for luck.',
  'Flour dust hung in the window light like weather of its own.',
  'She sold the last croissant to a courier who never stopped talking.',
];
const THREE = [
  'The clockmaker kept a drawer of hands that had outlived their faces.',
  'Each hand was labelled with the year it last moved, nothing more.',
  'He swore the second hands ticked louder the older they got.',
];
const FOUR = [
  'The lighthouse keeper wound the great lamp every evening before dusk.',
  'She logged the weather in a book that never once left the tower.',
  'On the clearest nights she could see three other lights across the strait.',
  'A supply boat came once a month, weather allowing, with oil and letters.',
  'She answered every letter the same evening it arrived, never later.',
];
const ALPHA = [
  'The archivist numbered the boxes before she read what was in them.',
  'Box forty-one held only maps of rivers that had since been straightened.',
  'She pinned the oldest one above her desk and left the rest in order.',
];
const BETA = [
  'A gardener planted the same row of beans every single spring.',
  'She said a bean that came up crooked still fed the table.',
  'By autumn the crooked ones were taller than the straight ones.',
  'She kept the best seeds in a tin marked with the year.',
  'Visitors always asked her which row she trusted most, and she never said.',
];
const GAMMA = [
  'The ferryman kept a tin cup for passengers who brought their own tea.',
  'He refused tips twice and accepted the third without a word.',
  'The crossing took eleven minutes and he never once looked at a watch.',
];
const EMPTY_CHAPTER = [
  'The museum opened its side door only during the coldest month.',
  'Visitors signed a single ledger and were trusted to find the rooms.',
  'One case held a sled with its harness still buckled.',
];
const BRACKETED = [
  'The plaque beside the gate named <Seven eta> as the founding hour.',
  'Nobody who visited the yard could read the plaque from where they stood.',
  'The caretaker recited it from memory and refused to explain the hours.',
];
const SOLO = [
  'The tram driver rang the bell twice at the bridge and once at the mill.',
  'Passengers learned the pattern and stood up before the second ring.',
  'The mill stopped working years ago but the bell still slowed for it.',
];
const C1 = [
  'The night ferry ran without lights, guided by the second bell of the harbour.',
  'Passengers paid with coins dropped into a coffee tin bolted by the rail.',
  'Fog came in faster than the crossing, so the captain waited it out mid-river.',
];
const C2 = [
  'The village baker fired her oven with trimmed vine cuttings, never coal.',
  'The bread carried a faint sweetness that no wheat alone explains.',
  'She baked eleven loaves each morning and hid the twelfth for the school.',
  'The hidden loaf went to whichever child had tended the ash of the ovens.',
  'Nobody ever caught her leaving it, though half the village kept watch.',
];

const BOOKS: readonly Book[] = [
  {
    file: 'Download Consistency Fixture.epub',
    title: 'Download Consistency Fixture',
    uid: 'urn:openreader:download-consistency-fixture',
    spine: [
      { id: 'one', title: 'Consistency One', sentences: ONE },
      { id: 'two', title: 'Consistency Two', sentences: TWO },
      { id: 'three', title: 'Consistency Three', sentences: THREE },
      { id: 'four', title: 'Consistency Four', sentences: FOUR },
    ],
  },
  {
    file: 'Manage Delete Fixture.epub',
    title: 'Manage Delete Fixture',
    uid: 'urn:openreader:manage-delete-fixture',
    spine: [
      { id: 'alpha', title: 'Manage Alpha', sentences: ALPHA },
      { id: 'beta', title: 'Manage Beta', sentences: BETA },
      { id: 'gamma', title: 'Manage Gamma', sentences: GAMMA },
    ],
  },
  {
    file: 'Empty Parts Fixture.epub',
    title: 'Empty Parts Fixture',
    uid: 'urn:openreader:empty-parts-fixture',
    spine: [
      { id: 'cover', title: 'Empty Parts Cover', empty: true },
      { id: 'solo', title: 'Empty Parts Chapter', sentences: EMPTY_CHAPTER },
    ],
  },
  {
    file: 'Only Cover Fixture.epub',
    title: 'Only Cover Fixture',
    uid: 'urn:openreader:only-cover-fixture',
    spine: [
      { id: 'cover', title: 'Only Cover Front', empty: true },
      { id: 'back', title: 'Only Cover Back', empty: true },
    ],
  },
  {
    file: 'Bracket Fixture.epub',
    title: 'Bracket Fixture',
    uid: 'urn:openreader:bracket-fixture',
    spine: [{ id: 'bracket', title: 'Bracket Chapter', sentences: BRACKETED }],
  },
  {
    file: 'Solo Fixture.epub',
    title: 'Solo Fixture',
    uid: 'urn:openreader:solo-fixture',
    spine: [{ id: 'solo', title: 'Solo Chapter', sentences: SOLO }],
  },
  {
    file: 'Pause Control Fixture.epub',
    title: 'Pause Control Fixture',
    uid: 'urn:openreader:pause-control-fixture',
    spine: [
      { id: 'c1', title: 'Control Chapter One', sentences: C1 },
      { id: 'c2', title: 'Control Chapter Two', sentences: C2 },
    ],
  },
];

const CONTAINER = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>
`;

for (const book of BOOKS) {
  const members = book.spine.map(({ id, title, empty, sentences }) => ({
    name: `OEBPS/${id}.xhtml`,
    data: utf8(empty ? EMPTY_PAGE(title) : chapter(title, sentences ?? [])),
  }));
  const nav = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>Contents</title></head>
<body><nav epub:type="toc"><ol>
${book.spine.map(({ id, title }) => `  <li><a href="${id}.xhtml">${title}</a></li>`).join('\n')}
</ol></nav></body>
</html>
`;
  const opf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">${book.uid}</dc:identifier>
    <dc:title>${book.title}</dc:title>
    <dc:language>en</dc:language>
    <meta property="dcterms:modified">${new Date().toISOString()}</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    ${book.spine.map(({ id }) => `<item id="${id}" href="${id}.xhtml" media-type="application/xhtml+xml"/>`).join('\n    ')}
  </manifest>
  <spine>${book.spine.map(({ id }) => `<itemref idref="${id}"/>`).join('')}</spine>
</package>
`;
  const archive = zip([
    { name: 'META-INF/container.xml', data: utf8(CONTAINER) },
    { name: 'OEBPS/content.opf', data: utf8(opf) },
    { name: 'OEBPS/nav.xhtml', data: utf8(nav) },
    ...members,
  ], { level: 'store' });
  const directory = process.argv[2];
  if (!directory) {
    console.error('Usage: download-consistency-fixture.ts OUTPUT_DIRECTORY');
    process.exit(2);
  }
  mkdirSync(directory, { recursive: true });
  const out = join(directory, book.file);
  writeFileSync(out, archive);
  console.log(`${out} (${book.spine.length} spine items)`);
}
