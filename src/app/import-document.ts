import type { File } from 'expo-file-system';
import { Alert } from 'react-native';
import type { DocumentId } from '../core/document';
import { folderPath, type FolderId } from '../core/folders';
import type { Library } from './use-library';

/** Both arrival paths ask the same duplicate question; Cancel never opens or relocates the existing entry. */
export async function importDocument(library: Library, source: File, options: { move: boolean; folder?: FolderId | null }, open: (id: DocumentId) => void): Promise<void> {
  const { entry, duplicate } = await library.add(source, options);
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
