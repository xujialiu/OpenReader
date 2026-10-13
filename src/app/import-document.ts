import type { File } from 'expo-file-system';
import { Alert } from 'react-native';
import type { DocumentId } from '../core/document';
import { folderPath, type FolderId } from '../core/folders';
import type { Library } from './use-library';

/**
 * Both arrival paths ask the same two questions. A file already in the Library
 * asks whether to open it, and Cancel never opens or relocates the existing
 * entry. A file whose name a Document in its Folder already has asks whether to
 * keep both, and Cancel keeps nothing (#227).
 */
export async function importDocument(library: Library, source: File, options: { move: boolean; folder?: FolderId | null }, open: (id: DocumentId) => void): Promise<void> {
  const added = await library.add(source, { ...options, nameTaken: ({ name, free, folder }) => new Promise<boolean>((resolve) => {
    Alert.alert('Name already exists', `“${name}”\nLocation: ${folderPath(library.folders.getSnapshot().tree, folder)}\nKeep Both adds this one as “${free}”.`, [
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
      { text: 'Keep Both', onPress: () => resolve(true) },
    ], { cancelable: true, onDismiss: () => resolve(false) });
  }) });
  if (!added) return;
  const { entry, duplicate } = added;
  if (!duplicate) { open(entry.id); return; }
  const tree = library.folders.getSnapshot().tree;
  await new Promise<void>((resolve) => {
    Alert.alert('Document already exists', `“${entry.title}”\nLocation: ${folderPath(tree, tree.documents[entry.id] ?? null)}`, [
      { text: 'Cancel', style: 'cancel', onPress: () => resolve() },
      { text: 'Open existing document', onPress: () => {
        if (library.current(entry.id)) open(entry.id);
        else library.report('That document is no longer in the Library. Import it again.');
        resolve();
      } },
    ], { cancelable: true, onDismiss: resolve });
  });
}
