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
  const value = JSON.stringify({ version: 1, names: { ...displayNames(), [id]: name } });
  if (offlineNative) offlineNative.writeJson(file().uri, value);
  else file().write(value);
}
