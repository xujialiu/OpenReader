import { debugLog } from './debug-log';

const EVENTS = new Set([
  'capture.started', 'session.route', 'session.interruption',
  'engine.start.request', 'engine.start.done', 'engine.pause.request', 'engine.pause.done',
  'engine.rebuild.begin', 'engine.rebuild.end', 'interruption.began',
  'interruption.end.resume', 'interruption.end.hold',
]);
const NUMBERS = ['sequence', 'nativeMs', 'uptimeMs', 'state', 'running', 'reason', 'outputLatency', 'ioDuration', 'sampleRate', 'type', 'options'] as const;

/** Fixed vocabulary and numeric facts only. Never serialize native userInfo. */
export function recordNativePlayback(batch: unknown, receivedMs: number): void {
  if (!batch || typeof batch !== 'object') return;
  const { events, dropped } = batch as { events?: unknown; dropped?: unknown };
  if (typeof dropped === 'number' && Number.isFinite(dropped) && dropped > 0) {
    debugLog('playback', `native dropped=${dropped}`);
  }
  if (!Array.isArray(events)) return;
  for (const item of events.slice(0, 128)) {
    if (!item || typeof item !== 'object') continue;
    const event = item as Record<string, unknown>;
    if (typeof event.event !== 'string' || !EVENTS.has(event.event)) continue;
    const fields = NUMBERS.flatMap((key) => {
      const value = event[key];
      return typeof value === 'number' && Number.isFinite(value) ? [`${key}=${value}`] : [];
    });
    debugLog('playback', `native ${event.event} receivedMs=${receivedMs} ${fields.join(' ')}`);
  }
}
