/**
 * Whether the status editor is open (ADR-0060). One editor, hosted by the
 * root layout, so the you-menu and your rider page open the same one.
 */
let open = $state(false);

export const statusEditor = {
	get open() {
		return open;
	},
	show() {
		open = true;
	},
	close() {
		open = false;
	},
};
