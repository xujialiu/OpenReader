import { openDatabaseAsync } from "expo-sqlite";
import { OfflineCatalog } from "./catalog";
import { OfflineRepository } from "./repository";
import { audioFiles } from "./audio-files";
import { offlineDirectory } from "./audio-paths";

let opening: Promise<OfflineRepository> | null = null;
export function offlineRepository(): Promise<OfflineRepository> {
  opening ??= (async () => {
    // The parent is excluded from backup alongside its audio payloads.
    const db = await openDatabaseAsync(
      "catalog.sqlite",
      {},
      offlineDirectory().uri,
    );
    try {
      const catalog = new OfflineCatalog(db);
      await catalog.initialize();
      const repository = new OfflineRepository(catalog, audioFiles);
      await repository.recover();
      return repository;
    } catch (error) {
      await db.closeAsync();
      throw error;
    }
  })().catch((error) => {
    opening = null;
    throw error;
  });
  return opening;
}
