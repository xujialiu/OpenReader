import { DatabaseSync, type SQLInputValue } from 'node:sqlite';

export function openDatabaseSync() {
  const db = new DatabaseSync(':memory:');
  return {
    execSync: (sql: string) => db.exec(sql),
    runSync: (sql: string, ...params: SQLInputValue[]) => db.prepare(sql).run(...params),
    getFirstSync: (sql: string, ...params: SQLInputValue[]) => db.prepare(sql).get(...params),
    getAllSync: (sql: string, ...params: SQLInputValue[]) => db.prepare(sql).all(...params),
    withTransactionSync: (work: () => void) => {
      db.exec('BEGIN');
      try { work(); db.exec('COMMIT'); }
      catch (error) { db.exec('ROLLBACK'); throw error; }
    },
  };
}
