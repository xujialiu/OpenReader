/**
 * Imported by `index.ts` before the app itself, so that the Debug Log is
 * listening before the app runs (ADR 0054). First reject a stale native shell
 * whose build role differs from Metro's fixed role (#324).
 */
import { debugLogNative } from '../../modules/open-reader-debug-log';
import { assertNativeVariant } from '../build/variant-check';
import { installDebugLog } from './install';

assertNativeVariant(debugLogNative?.buildVariant);
installDebugLog();
