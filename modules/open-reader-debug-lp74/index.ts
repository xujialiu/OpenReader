// DEBUG-lp74: temporary diagnostics for issue #74 (a long press that starts no
// text selection on the phone). Remove this module, and its one caller in
// src/app/walkthrough-harness.ts, with the fix.
import { requireOptionalNativeModule } from 'expo';

interface DebugLp74Native {
  /** One line to the phone's persisted log, subsystem top.xujialiu.openreader.lp74. */
  mark(line: string): void;
}

const native = requireOptionalNativeModule<DebugLp74Native>('OpenReaderDebugLp74');

/** DEBUG-lp74: persist a line beside the native long-press diagnostics. */
export function markLp74(line: string): void {
  native?.mark(line);
}
