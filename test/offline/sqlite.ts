import { DatabaseSync } from "node:sqlite";
import {
  OfflineCatalog,
  type SqlDatabase,
  type SqlSession,
} from "../../src/offline/catalog";

export function testCatalog() {
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
