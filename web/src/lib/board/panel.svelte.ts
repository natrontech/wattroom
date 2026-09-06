/**
 * Whether the board is on screen. Module state so it survives moving between
 * a room's places, which remount the shell.
 *
 * ponytail: not persisted across reloads — `pane.ts` already remembers WHERE
 * the rider dragged it, and B reopens it in one press. Persist if riders ask.
 */
let open = $state(false);

export const boardPanel = {
	get open() {
		return open;
	},
	show() {
		open = true;
	},
	hide() {
		open = false;
	},
	toggle() {
		open = !open;
	},
};
