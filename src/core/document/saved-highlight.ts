export const HIGHLIGHT_PALETTE = {
  yellow: '#ffc64c', green: '#73df92', pink: '#f58acb', purple: '#bc96ef', blue: '#67bff4',
};
export type HighlightColour = keyof typeof HIGHLIGHT_PALETTE;

export interface Passage {
  section: number;
  cfi: string;
  text: string;
  block: number;
  offset: number;
  endBlock: number;
}
export interface SavedHighlight extends Passage {
  id: number;
  colour: HighlightColour;
  chapter: string;
  chapterKey: string;
}

export interface SelectionLocation extends Passage {
  inside: number | null;
  top: number;
  bottom: number;
}
