/**
 * The chord that shows and hides the board (#877 follow-up).
 *
 * It used to be a bare `b` on the window, which fired whenever focus was on
 * anything that is not a text field — a button, a link, the page itself. A
 * modifier is what makes a global shortcut a shortcut rather than a hazard, so
 * the default is Alt+B and the rider can move it.
 *
 * Per device, like the mixer: which chord suits you depends on the keyboard in
 * front of you, not on the account.
 */
const KEY = 'wattroom.board.toggle.v1';

export interface Chord {
	/** Lower-cased single character. */
	key: string;
	alt: boolean;
	ctrl: boolean;
	shift: boolean;
	meta: boolean;
}

export const DEFAULT_CHORD: Chord = {
	key: 'b',
	alt: true,
	ctrl: false,
	shift: false,
	meta: false,
};

function read(): Chord {
	try {
		const raw = globalThis.localStorage?.getItem(KEY);
		if (!raw) return DEFAULT_CHORD;
		const parsed = JSON.parse(raw) as Partial<Chord>;
		if (typeof parsed.key !== 'string' || parsed.key.length !== 1) {
			return DEFAULT_CHORD;
		}
		return {
			key: parsed.key.toLowerCase(),
			alt: !!parsed.alt,
			ctrl: !!parsed.ctrl,
			shift: !!parsed.shift,
			meta: !!parsed.meta,
		};
	} catch {
		return DEFAULT_CHORD;
	}
}

let chord = $state<Chord>(read());

/** Does this keystroke ask for the board? */
export function isToggle(event: KeyboardEvent): boolean {
	return (
		event.key.toLowerCase() === chord.key &&
		event.altKey === chord.alt &&
		event.ctrlKey === chord.ctrl &&
		event.shiftKey === chord.shift &&
		event.metaKey === chord.meta
	);
}

/** Human-readable, in the order a keyboard legend writes them. */
export function chordLabel(c: Chord): string {
	const parts: string[] = [];
	if (c.ctrl) parts.push('Ctrl');
	if (c.alt) parts.push('Alt');
	if (c.shift) parts.push('Shift');
	if (c.meta) parts.push('Cmd');
	parts.push(c.key.toUpperCase());
	return parts.join('+');
}

export const toggleKey = {
	get chord() {
		return chord;
	},
	get label() {
		return chordLabel(chord);
	},
	/**
	 * A chord with no modifier is refused: a bare letter on the window is the
	 * bug this module exists to fix, whoever asks for it.
	 */
	set(next: Chord): boolean {
		if (!next.alt && !next.ctrl && !next.meta) return false;
		chord = { ...next, key: next.key.toLowerCase() };
		try {
			globalThis.localStorage?.setItem(KEY, JSON.stringify(chord));
		} catch {
			// device-only preference; losing it costs one rebind
		}
		return true;
	},
	reset() {
		chord = DEFAULT_CHORD;
		try {
			globalThis.localStorage?.removeItem(KEY);
		} catch {
			// as above
		}
	},
};
