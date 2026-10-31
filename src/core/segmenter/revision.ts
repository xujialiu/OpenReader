/**
 * Revision of the rules that turn Blocks into Utterances: sentence boundaries,
 * language resolution and rejoining. Raise it whenever those change saved text.
 * Separate from the renderer's BLOCK_WALK: either can invalidate a Download's
 * prepared text without changing the other (#240, #245, #241, #242).
 *
 * 2: brackets pair by type, an inch mark or clipped word is no quotation mark,
 * and a citation bracket alone continues no sentence (#183, #244, #243, #247).
 */
export const SEGMENTATION = 2;
