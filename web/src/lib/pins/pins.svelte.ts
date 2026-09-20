/**
 * Pins (#2405): a crew keeps a handful of facts that nothing else holds — the
 * game server and its address and its password, the Discord link, the door
 * code — and chat cannot, because `PruneChat` caps a room at 500 lines.
 *
 * A pin is a **title and a block of lines**, not a key and a value. One thing
 * worth pinning is rarely one string: a server is an address AND a password
 * AND who to ask about the whitelist, and splitting that across three cards
 * loses which server they belong to.
 *
 * The crew owns them and the room is where they are read, so every room of a
 * crew shows the same board.
 */
export interface Pin {
	id: string;
	title: string;
	/** Free text. `parsePin` decides which lines are copyable. */
	body: string;
}

/**
 * A value that is a link opens on click; everything else copies. One branch
 * instead of a `kind` the pinner would have to set — and getting it wrong
 * costs a wrong icon, never a wrong action, because the menu carries both.
 */
export const isLink = (value: string) => /^https?:\/\//i.test(value.trim());

/** A line of a pin: a copyable field, or prose. */
export type PinLine =
	| { kind: 'field'; label: string; value: string }
	| { kind: 'text'; text: string };

/**
 * `Label: value` becomes a row with its own copy button; everything else is
 * prose. A textarea instead of a field repeater is the whole point: nobody
 * adds a row, names it and fills it — they type what they would have typed
 * into chat, and the lines that happen to be facts become tappable.
 *
 * **The space after the colon is load-bearing.** It is what separates a field
 * from a sentence that merely contains a colon: `Start: 20:00` is a field
 * whose value is a time, while `We start at 20:00` is prose, and without the
 * space the second one becomes a field labelled "We start at 20". It also
 * excludes a bare URL for free — `https://…` has no space after its colon —
 * so a link on its own line is recognised as a link rather than shredded into
 * a field called "https".
 */
const FIELD = /^([^:\n]{1,32}):[ \t]+(\S.*)$/;

export function parsePin(body: string): PinLine[] {
	const lines: PinLine[] = [];
	for (const raw of body.split('\n')) {
		const line = raw.trim();
		// Blank lines are the writer's paragraphing, not content. The card
		// spaces prose off the fields itself, so they are dropped rather than
		// rendered as gaps that grow with however many Enters were pressed.
		if (!line) continue;
		if (isLink(line)) {
			lines.push({ kind: 'field', label: '', value: line });
			continue;
		}
		const field = FIELD.exec(line);
		lines.push(
			field
				? { kind: 'field', label: field[1].trim(), value: field[2].trim() }
				: { kind: 'text', text: line },
		);
	}
	return lines;
}

/**
 * ponytail: the mock's stand-in for the API. One in-memory list for the whole
 * app, so the sidebar's gate and the place cannot disagree about whether this
 * crew has pins. The real one reads them off the room payload and writes them
 * over the socket; only this file changes.
 */
export const pins = $state<{ items: Pin[] }>({
	items: [
		{
			id: 'mc',
			title: 'Minecraft',
			body: [
				'Address: mc.natron.io:25565',
				'Password: kilojoule-hammer-42',
				'Version: 1.21.4',
				'',
				'Whitelist is on — ask Nina to add you.',
			].join('\n'),
		},
		{
			id: 'dc',
			title: 'Discord',
			body: 'https://discord.gg/wattroom\n\nVoice for the games; the ride stays in here.',
		},
		{
			id: 'gym',
			title: 'The garage',
			body: 'Door code: 4417\n\nLast one out shuts the roller door.',
		},
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
