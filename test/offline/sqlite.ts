import { DatabaseSync } from "node:sqlite";
import {
  OfflineCatalog,
  type SqlDatabase,
  type SqlSession,
} from "../../src/offline/catalog";

/** A real SQLite database. `observe.transaction` is called once per exclusive transaction, for the tests that count them. */
export function testCatalog(observe?: { transaction?(): void }) {
  const db = new DatabaseSync(":memory:");
  const session: SqlSession = {
    execAsync: async (sql) => {
      db.exec(sql);
    },
    runAsync: async (sql, ...params) => {
      db.prepare(sql).run(...params);
    },
    getAllAsync: async <T>(
      sql: string,
      ...params: (string | number | null)[]
    ) => db.prepare(sql).all(...params) as T[],
  };
  const connection: SqlDatabase = {
    ...session,
    withExclusiveTransactionAsync: async (run) => {
      observe?.transaction?.();
      db.exec("BEGIN");
      try {
        await run(session);
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
  };
  return { catalog: new OfflineCatalog(connection), close: () => db.close() };
}
