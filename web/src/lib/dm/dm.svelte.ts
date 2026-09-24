/**
 * The open DM thread (#208) — module state so any surface (friends panel,
 * member popout) can open it and the one drawer follows. Where the reader
 * has read up to is the server's (#2711), so it agrees on every device;
 * the thread store moves it.
 */
let open = $state<{ id: string; name: string } | null>(null);

export const dm = {
	get open() {
		return open;
	},
	// Neither marks the thread read (#1819): opening a thread is not reading
	// it. The thread store does, when lines actually arrived in a visible
	// tab, which is the one condition under which the rider could have seen
	// them.
	show(id: string, name: string) {
		open = { id, name };
	},
	close() {
		open = null;
	},
};
