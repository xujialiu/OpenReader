/** Density B, chosen from the #121 side-by-side prototype. Both row kinds use these values. */
export const LIBRARY_ROW = {
  height: 84,
  illustrationWidth: 56,
  cover: { width: 40, height: 56 },
  folder: { width: 44, height: 38 },
} as const;

/** Scale the shared row, not one row's measured title: short and long names keep the same rhythm. */
export function libraryRowHeight(fontScale: number): number {
  return Math.ceil(LIBRARY_ROW.height * Math.max(1, fontScale));
}

/** Counts are immediate children only; neither reading progress nor descendants belong here. */
export function folderSummary(documents: number, folders: number): string {
  const parts = [];
  if (documents > 0) parts.push(`${documents} document${documents === 1 ? '' : 's'}`);
  if (folders > 0) parts.push(`${folders} folder${folders === 1 ? '' : 's'}`);
  return parts.length ? parts.join(' · ') : 'Empty';
}
