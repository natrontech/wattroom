/**
 * Pins (ADR-0056, #2405): a crew keeps a handful of facts that nothing else
 * holds — the game server and its address and its password, the Discord link,
 * the door code — and chat cannot, because a text channel's log is capped at
 * 500 lines and anything posted there is on a timer.
 *
 * A pin is a **title and a block of lines**, not a key and a value. One thing
 * worth pinning is rarely one string, and splitting a server across three
 * cards loses which server they belong to.
 *
 * The crew owns the board and its Board page is where it is read (#2413), so
 * a crew has exactly one. Everyone in the crew writes it; nothing asks who
 * wrote a pin.
 */
import { api } from '$lib/api';
import { MaxCrewPins } from '$lib/protocol';

export interface Pin {
	id: string;
	title: string;
	body: string;
	/** Who wrote it. Absent once that account is gone — the pin outlives it. */
	createdBy?: string;
	createdAt?: string;
	updatedAt?: string;
}

/** What a pin is written as: everything but the server's own columns. */
export type PinDraft = Pick<Pin, 'title' | 'body'>;

/**
 * A value that is a link opens on click; everything else copies. One branch
 * instead of a `kind` the pinner would have to set — and getting it wrong
 * costs a wrong icon, never a wrong action, because the menu carries both.
 */
export const isLink = (value: string) => /^https?:\/\//i.test(value.trim());

/**
 * A link as a card shows it: no scheme, no `www.`, no trailing slash. The
 * card has room for one line of it and the scheme is the part nobody reads;
 * the anchor keeps the whole URL.
 */
export const bareLink = (url: string) =>
	url
		.trim()
		.replace(/^https?:\/\/(www\.)?/i, '')
		.replace(/\/$/, '');

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

/** The board is full — the count the server enforces, read from protocol. */
export const boardFull = (pins: Pin[]) => pins.length >= MaxCrewPins;

const base = (crewId: string) => `/api/crews/${crewId}/pins`;

export const fetchPins = (crewId: string) => api<Pin[]>(base(crewId));

export const createPin = (crewId: string, draft: PinDraft) =>
	api<Pin>(base(crewId), { method: 'POST', json: draft });

export const updatePin = (crewId: string, id: string, draft: PinDraft) =>
	api<Pin>(`${base(crewId)}/${id}`, { method: 'PATCH', json: draft });

export const deletePin = (crewId: string, id: string) =>
	api<void>(`${base(crewId)}/${id}`, { method: 'DELETE' });
