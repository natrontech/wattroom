/**
 * Whether the board is on screen, and which of its three faces it is showing.
 * Module state so it survives moving between a room's places, which remount
 * the shell.
 *
 * The faces are one panel, not a stack of modals (#981). The library and the
 * trim editor used to be `<Modal>`s opened from the board, which made the
 * board count its own children in `modals.open` and dim itself out of the way
 * of the thing it had just opened — three surfaces deep, each hiding the one
 * that opened it.
 *
 * ponytail: not persisted across reloads — `pane.ts` already remembers WHERE
 * the rider dragged it, and the chord reopens it in one press. Persist if
 * riders ask.
 */
export type Face = 'board' | 'clips' | 'trim';

let open = $state(false);
let face = $state<Face>('board');
/** Which clip the trim face is editing; nothing on any other face. */
let trimming = $state<string | null>(null);

export const boardPanel = {
	get open() {
		return open;
	},
	get face() {
		return face;
	},
	get trimming() {
		return trimming;
	},
	show() {
		open = true;
	},
	/**
	 * Closing puts it back on the board. Reopening onto a half-finished trim
	 * of a clip the rider has stopped thinking about is not where they left
	 * off — it is where they abandoned something.
	 */
	hide() {
		open = false;
		face = 'board';
		trimming = null;
	},
	toggle() {
		if (open) this.hide();
		else open = true;
	},
	go(next: Face) {
		if (next === 'trim' && !trimming) return;
		face = next;
		if (next !== 'trim') trimming = null;
	},
	trim(clipId: string) {
		trimming = clipId;
		face = 'trim';
	},
	/** One step back towards the pads — trim came from the clips face. */
	back() {
		if (face === 'trim') {
			trimming = null;
			face = 'clips';
		} else {
			face = 'board';
		}
	},
};
