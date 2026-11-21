import { openDatabaseSync, type SQLiteDatabase } from 'expo-sqlite';
import type { HighlightColour, Passage, SavedHighlight } from '../core/document/saved-highlight';

let database: SQLiteDatabase | undefined;
function db(): SQLiteDatabase {
  if (database) return database;
  const connection = openDatabaseSync('saved-highlights.db');
  connection.execSync(`
    CREATE TABLE IF NOT EXISTS highlight (
      id INTEGER PRIMARY KEY AUTOINCREMENT, document TEXT NOT NULL, section INTEGER NOT NULL,
      cfi TEXT NOT NULL, text TEXT NOT NULL, block INTEGER NOT NULL, offset INTEGER NOT NULL,
      endBlock INTEGER NOT NULL, chapter TEXT NOT NULL, chapterKey TEXT NOT NULL, colour TEXT NOT NULL,
      UNIQUE(document, cfi)
    );
    CREATE TABLE IF NOT EXISTS pen (singleton INTEGER PRIMARY KEY CHECK(singleton = 1), colour TEXT NOT NULL);
  `);
  database = connection;
  return connection;
}

export function readHighlights(document: string): SavedHighlight[] {
  return db().getAllSync<SavedHighlight>('SELECT * FROM highlight WHERE document = ? ORDER BY section, block, offset, id', document);
}

export function saveHighlight(document: string, passage: Passage, chapter: string, chapterKey: string): number {
  const { section, cfi, text, block, offset, endBlock } = passage;
  return db().getFirstSync<{ id: number }>(`INSERT INTO highlight
    (document, section, cfi, text, block, offset, endBlock, chapter, chapterKey, colour)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE((SELECT colour FROM pen), 'yellow'))
    ON CONFLICT(document, cfi) DO UPDATE SET cfi = excluded.cfi RETURNING id`,
  document, section, cfi, text, block, offset, endBlock, chapter, chapterKey)!.id;
}

export function colourHighlight(document: string, id: number, colour: HighlightColour): void {
  const connection = db();
  connection.withTransactionSync(() => {
    if (connection.runSync('UPDATE highlight SET colour = ? WHERE document = ? AND id = ?', colour, document, id).changes) {
      connection.runSync('INSERT OR REPLACE INTO pen VALUES (1, ?)', colour);
    }
  });
}

export function removeHighlights(document: string, ids: readonly number[]): void {
  const connection = db();
  connection.withTransactionSync(() => {
    for (const id of ids) connection.runSync('DELETE FROM highlight WHERE document = ? AND id = ?', document, id);
  });
}

export function restoreHighlight(document: string, mark: SavedHighlight): void {
  db().runSync(`INSERT INTO highlight (id, document, section, cfi, text, block, offset, endBlock, chapter, chapterKey, colour)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(document, cfi) DO NOTHING`,
  mark.id, document, mark.section, mark.cfi, mark.text, mark.block, mark.offset, mark.endBlock, mark.chapter, mark.chapterKey, mark.colour);
}

export function clearDocumentHighlights(document: string): void {
  db().runSync('DELETE FROM highlight WHERE document = ?', document);
}
export function highlightDeletionNotice(documents: Iterable<string>): string {
  let count = 0;
  for (const document of documents) count += db().getFirstSync<{ n: number }>('SELECT count(*) AS n FROM highlight WHERE document = ?', document)!.n;
  return count ? ` ${count} saved highlight${count === 1 ? '' : 's'} will also be deleted.` : '';
}
