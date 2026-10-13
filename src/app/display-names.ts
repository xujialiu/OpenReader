import { File, Paths } from 'expo-file-system';
import { offlineNative } from '../../modules/open-reader-offline';

/** ADR 0003: new information goes in a sibling file, not the shared catalogue. */
const file = () => new File(Paths.document, 'display-names.json');
export function displayNames(): Record<string, string> {
  const source = file();
  if (!source.exists) return {};
  const parsed = JSON.parse(source.textSync());
  if (parsed.version !== 1 || !parsed.names || typeof parsed.names !== 'object') throw new Error('Display names could not be read. The file has been kept.');
  return parsed.names;
}
export function saveDisplayName(id: string, name: string): void {
  write({ ...displayNames(), [id]: name });
}
/**
 * Drop the name kept for a Document Id, when the same EPUB is added again as a
 * new entry (#180): the name went with the entry the owner deleted, and left
 * here it would come back over the file's name at the next launch.
 */
export function forgetDisplayName(id: string): void {
  const { [id]: _forgotten, ...names } = displayNames();
  write(names);
}
function write(names: Record<string, string>): void {
  const value = JSON.stringify({ version: 1, names });
  if (offlineNative) offlineNative.writeJson(file().uri, value);
  else file().write(value);
}
