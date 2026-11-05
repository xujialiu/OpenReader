/** Margins is a per-side percentage of the reading viewport (#344, ADR 0085).
 * Points exist only while an old settings file waits for its first reader width. */
export const MARGINS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25] as const;
export type Margin = number;
export interface MarginSetting {
  margins: Margin;
  /** Omitted by in-memory callers means percent; persisted legacy files are read explicitly. */
  marginsUnit?: 'percent' | 'points';
}
const LEGACY_MARGINS = [8, 12, 16, 20, 24, 28, 32, 36, 40, 44, 48];
export const DEFAULT_MARGIN = 5;

export function stepMargins(margins: Margin, direction: 1 | -1): Margin | null {
  return MARGINS.find((value) => value === margins + direction) ?? null;
}

/** No arbitrary number or unit from disk may enter a stylesheet. */
export function readMarginSetting(value: unknown, unit: unknown): MarginSetting {
  if ((unit === undefined || unit === 'points') && LEGACY_MARGINS.includes(value as number)) {
    return { margins: value as number, marginsUnit: 'points' };
  }
  const percent = unit === 'percent' ? MARGINS.find((one) => one === value) : undefined;
  return { margins: percent ?? DEFAULT_MARGIN, marginsUnit: 'percent' };
}

/** Called only with the visible reader's measured width; unrelated saves keep the old unit. */
export function resolveMargins<T extends MarginSetting>(appearance: T, width: number): T {
  if (appearance.marginsUnit !== 'points' || !Number.isFinite(width) || width <= 0) return appearance;
  return { ...appearance, margins: Math.min(25, Math.max(0, Math.round(100 * appearance.margins / width))), marginsUnit: 'percent' };
}

export function marginCssValue(appearance: MarginSetting): string {
  const { margins, marginsUnit } = readMarginSetting(appearance.margins, appearance.marginsUnit ?? 'percent');
  return `${margins}${marginsUnit === 'points' ? 'px' : '%'}`;
}
