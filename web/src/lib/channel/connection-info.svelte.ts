/**
 * Whose connection the room is being asked about (#2131).
 *
 * A module store and one host in the root layout, the shape `confirm` and the
 * context menu already use: the entry is on `personMenu`, so every surface
 * that draws a person offers it — the tile, the people column, the crew
 * strip, the member list — and none of them has to mount a panel of its own.
 *
 * Holds an id and not a rider: the roster is rebuilt from every tick, and a
 * copy taken when the menu opened would stop moving the moment it was read.
 */
let asked = $state<string | null>(null);

export const connectionInfo = {
	get riderId(): string | null {
		return asked;
	},
	open(riderId: string) {
		asked = riderId;
	},
	close() {
		asked = null;
	},
};
