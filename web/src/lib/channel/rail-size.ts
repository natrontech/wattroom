/**
 * The people column's control sizes (#3828). While a ride is under way the
 * column is part of a riding surface, and everything in it is touched while
 * pedalling: 44 px (TARGETS G5, ux.md). At the desk it keeps the kit's small
 * sizes, which its 272 px were drawn for. One home, so the jukebox's buttons,
 * fields and folds cannot each pick their own.
 */

/**
 * A button: 44 px tall on the kit's own padding while riding, btn-xs at the
 * desk. Not btn-lg, whose 20 px sides would take the room the jukebox's
 * search field needs for its placeholder at the column's narrowest (#3912).
 */
export const railButton = (riding: boolean) => (riding ? 'min-h-11' : 'btn-xs');

/** A text field beside a railButton, as tall as it. */
export const railField = (riding: boolean) =>
	riding ? 'input-xs min-h-11' : 'input-xs';

/** A fold's `<summary>`: its 10 px eyebrow padded to 47 px, or 31 px. */
export const railFold = (riding: boolean) => (riding ? 'py-4' : 'py-2');
