import { File, Paths } from 'expo-file-system';
import { createFolderStore } from '../core/folders';

/** Separate from the Library/Positions File: folder organization belongs to this device, not to Zotero sync. */
export function openFolderStore() {
  return createFolderStore({
    read: () => {
      const file = new File(Paths.document, 'library-folders.json');
      return file.exists ? file.textSync() : null;
    },
    write: (text) => {
      const pending = new File(Paths.document, 'library-folders.pending.json');
      pending.write(text);
      pending.moveSync(new File(Paths.document, 'library-folders.json'), { overwrite: true });
    },
    id: () => `folder-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
  });
}
