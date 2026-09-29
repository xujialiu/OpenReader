/**
 * Imported by `index.ts` before the app itself, so that the Debug Log is
 * listening before any of the app's own modules run (ADR 0054). Nothing but
 * this call: `install.ts` says what it does, and in a build without Debug Mode
 * it does nothing.
 */
import { installDebugLog } from './install';

installDebugLog();
