/**
 * The sidebar on a riding surface (#3770). The cave covers it (TARGETS G1),
 * so its words take SPEC's 24 px (G4, D1) and its rows the 44 px a pedalling
 * thumb gets (ux.md). Under `.cave` only: the desk keeps its own sizes.
 */

/** A row you tap: 44 px tall, its words 24 px. */
export const CAVE_ROW = 'cave:min-h-11 cave:gap-3 cave:text-2xl';

/** A row's mark, the height of its words. */
export const CAVE_MARK = 'cave:size-6';

/** Words that are not a row of their own: a name, the line under it. */
export const CAVE_WORDS = 'cave:text-2xl';
