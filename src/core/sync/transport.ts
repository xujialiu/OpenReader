/**
 * Carries the Positions File between this device and the Sync Folder: the
 * shape of the desktop plugin's `position-transport.ts`, on this side of the
 * contract.
 *
 * Every sync is **download, merge, adopt, conditional upload** (spec 2.4):
 * fetch the file, merge it with the positions this device holds — per document,
 * newer Stamp wins — offer every usable merged item to the Library, which takes
 * what is newer than its own, and upload the union only when its canonical
 * text differs from what came down. Items for documents this device does not
 * hold, and items it cannot use, ride through untouched.
 *
 * Event-driven and single-flight: a poke never blocks, a burst of pokes is one
 * run plus one trailing run (`core/single-flight.ts`), and `flush` is the
 * awaited form for the two moments that wait on the answer — opening a book
 * and pressing Play — which the caller bounds with its own timeout. Its answer
 * is its own run's outcome, handed back by the run itself: a poke that queues a
 * run meanwhile starts that run before the caller resumes (#54).
 *
 * Failures follow the plugin's pattern: the outcome is recorded, reported once
 * per retry window, and nothing is retried inside that window unless forced.
 * Two remote conditions part ways on purpose. A malformed file is treated as
 * absent and healed by the upload; a file of a **newer version** is left
 * strictly alone — no adoption, no upload — because a build too old to read a
 * file must not write over what a newer one wrote (spec 2.1).
 *
 * Nothing here imports the platform. `fetch` reaches it inside the client the
 * caller builds, and the Library reaches it through `local` and `adopt`.
 */

import { createSingleFlight } from '../single-flight';
import { WebDAVError } from './webdav';
import {
  mergePositions,
  parsePositionsFile,
  POSITIONS_FILENAME,
  serializePositionsFile,
  usableItems,
  type FileItem,
  type PositionsItem,
} from './positions-file';

/** A failed sync is retried at most once per window, and reported once per window. */
export const SYNC_RETRY_MS = 60_000;

/** The slice of the WebDAV client a sync drives. */
export interface SyncClient {
  download(name: string): Promise<string>;
  upload(name: string, text: string): Promise<void>;
}

export interface PositionsTransportDeps {
  /** Whether the owner has sync on. Read per run, so a switch turned off stops the next run. */
  enabled(): boolean;
  /** A client for the settings as they are now; throws `WebDAVError('config')` for an unusable address. */
  client(): Promise<SyncClient>;
  /** Every position this device holds, as items. Entries without a position contribute nothing. */
  local(): readonly PositionsItem[];
  /** Offer the merged usable items; the Library takes what is newer than its own and says which. */
  adopt(items: readonly PositionsItem[]): readonly string[];
  now(): number;
  /** One sentence about what went wrong, at most once per retry window. */
  report(problem: string): void;
  /** After every completed run, skipped ones excepted. */
  onSynced?(outcome: SyncOutcome): void;
}

/** What the last run did, for the status line. */
export interface SyncOutcome {
  at: number;
  trigger: string;
  /** `frozen` is a newer file on the server, which this build must leave alone. */
  result: 'ok' | 'error' | 'frozen';
  error: string | null;
  /** Items in the file as downloaded, before the merge. */
  remote: number;
  /** Document Ids whose position moved on this device. */
  adopted: readonly string[];
  uploaded: boolean;
}

export interface PositionsTransport {
  /** Schedule a run; never blocks. A burst coalesces into the running one plus one trailing run. */
  poke(trigger: string): void;
  /**
   * One awaited run, forced past the retry window. Resolves with that run's
   * outcome — never the outcome of a run started after it — or null when sync is off.
   */
  flush(trigger: string): Promise<SyncOutcome | null>;
  last(): SyncOutcome | null;
  running(): boolean;
}

export function createPositionsTransport(deps: PositionsTransportDeps): PositionsTransport {
  let last: SyncOutcome | null = null;
  let lastFailureAt = Number.NEGATIVE_INFINITY;
  let lastReportAt = Number.NEGATIVE_INFINITY;

  function reportGated(problem: string): void {
    const at = deps.now();
    if (at - lastReportAt < SYNC_RETRY_MS) return;
    lastReportAt = at;
    try {
      deps.report(problem);
    } catch {
      // Reporting must never be the thing that fails a sync.
    }
  }

  function finish(outcome: SyncOutcome): SyncOutcome {
    last = outcome;
    try {
      deps.onSynced?.(outcome);
    } catch {
      // The listener's failure is its own.
    }
    return outcome;
  }

  /** Never rejects. Null is a run that did not happen: sync is off, or an unforced one inside the retry window. */
  async function run(trigger: string, force: boolean): Promise<SyncOutcome | null> {
    if (!deps.enabled()) return null;
    if (!force && deps.now() - lastFailureAt < SYNC_RETRY_MS) return null;
    const at = deps.now();
    try {
      const client = await deps.client();
      let remoteText: string | null = null;
      try {
        remoteText = await client.download(POSITIONS_FILENAME);
      } catch (problem) {
        // No file yet is the ordinary first run, not a failure.
        if (!(problem instanceof WebDAVError) || problem.kind !== 'not-found') throw problem;
      }
      let remote: readonly FileItem[] = [];
      if (remoteText !== null) {
        const parsed = parsePositionsFile(remoteText);
        if (parsed.ok) {
          remote = parsed.items;
        } else if (parsed.reason === 'newer') {
          const error = `The positions file on the server is version ${parsed.version}, which this version of the app does not read. It was left alone; update the app to sync again.`;
          reportGated(error);
          return finish({ at, trigger, result: 'frozen', error, remote: 0, adopted: [], uploaded: false });
        } else {
          // Treated as absent and healed by the upload below; said once.
          reportGated(`The positions file on the server could not be read (${parsed.why}) and will be replaced.`);
          remoteText = null;
        }
      }
      const merged = mergePositions(deps.local(), remote);
      const adopted = deps.adopt(usableItems(merged));
      const text = serializePositionsFile(merged);
      let uploaded = false;
      if (remoteText === null ? merged.length > 0 : text !== remoteText) {
        await client.upload(POSITIONS_FILENAME, text);
        uploaded = true;
      }
      lastFailureAt = Number.NEGATIVE_INFINITY;
      return finish({ at, trigger, result: 'ok', error: null, remote: remote.length, adopted, uploaded });
    } catch (problem) {
      const error = problem instanceof Error ? problem.message : String(problem);
      lastFailureAt = deps.now();
      reportGated(error);
      return finish({ at, trigger, result: 'error', error, remote: 0, adopted: [], uploaded: false });
    }
  }

  const flight = createSingleFlight(run);

  return {
    poke: flight.poke,
    flush: flight.flush,
    last: () => last,
    running: flight.running,
  };
}
