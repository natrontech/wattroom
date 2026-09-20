/**
 * Pins (#2405): a label and a value, and that is the whole data model. No
 * rich text, no attachments, no comments — a crew keeps a handful of facts
 * that nothing else holds (the game server and its password, the Discord
 * link, the door code) and chat cannot, because `PruneChat` caps a room at
 * 500 lines.
 *
 * The crew owns them and the room is where they are read, so every room of
 * a crew shows the same set.
 */
export interface Pin {
	id: string;
	label: string;
	value: string;
}

/**
 * A value that is a link opens on click; everything else copies. One branch
 * instead of a `kind` column the pinner would have to set — and getting it
 * wrong costs a wrong icon, never a wrong action, because the menu carries
 * both.
 */
export const isLink = (value: string) => /^https?:\/\//i.test(value.trim());

/**
 * ponytail: the mock's stand-in for the API. One in-memory list for the whole
 * app, so the sidebar's gate and the page cannot disagree about whether this
 * crew has pins. The real one reads them off the room payload and writes them
 * over the socket; only this file changes.
 */
export const pins = $state<{ items: Pin[] }>({
	items: [
		{ id: 'mc', label: 'Minecraft', value: 'mc.natron.io:25565' },
		{ id: 'pw', label: 'Server password', value: 'kilojoule-hammer-42' },
		{ id: 'dc', label: 'Discord', value: 'https://discord.gg/wattroom' },
	],
});

let seq = 0;

/** Write a pin, new or edited. An edit keeps its place in the list. */
export function savePin(pin: Pin | Omit<Pin, 'id'>): void {
	const id = 'id' in pin ? pin.id : `pin-${++seq}`;
	const at = pins.items.findIndex((p) => p.id === id);
	// ponytail: an undone unpin lands at the end rather than where it was.
	// The real one carries a sort key and restores the position with it.
	if (at >= 0) pins.items[at] = { ...pin, id };
	else pins.items.push({ ...pin, id });
}

export function removePin(id: string): void {
	pins.items = pins.items.filter((p) => p.id !== id);
}
