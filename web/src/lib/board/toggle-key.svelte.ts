/**
 * The chord that shows and hides the board (#877 follow-up).
 *
 * It used to be a bare `b` on the window, which fired whenever focus was on
 * anything that is not a text field — a button, a link, the page itself. A
 * modifier is what makes a global shortcut a shortcut rather than a hazard, so
 * the default is Alt+B and the rider can move it.
 *
 * The chord is a PHYSICAL key (`KeyboardEvent.code`), not the character the
 * keyboard produced (#982). On macOS, Option+B does not deliver `key: "b"` —
 * the Option layout composes a character and the browser sends `key: "∫"`
 * with `code: "KeyB"`. Matching on the character meant the shipped default
 * never fired on a Mac at all, and the same for every other Option+letter a
 * rider might pick (Option+C is `ç`, Option+K is `˚`). The label the rider
 * reads still says the letter.
 *
 * Per device, like the mixer: which chord suits you depends on the keyboard in
 * front of you, not on the account.
 */
const KEY = 'wattroom.board.toggle.v1';

export interface Chord {
	/** The physical key, as `KeyboardEvent.code` — `KeyB`, `Digit1`. */
	code: string;
	alt: boolean;
	ctrl: boolean;
	shift: boolean;
	meta: boolean;
}

export const DEFAULT_CHORD: Chord = {
	code: 'KeyB',
	alt: true,
	ctrl: false,
	shift: false,
	meta: false,
};

/** The `code` a single typed character came from, for chords stored before #982. */
function codeOf(key: string): string | undefined {
	if (/^[a-z]$/.test(key)) return `Key${key.toUpperCase()}`;
	if (/^[0-9]$/.test(key)) return `Digit${key}`;
	return undefined;
}

function read(): Chord {
	try {
		const raw = globalThis.localStorage?.getItem(KEY);
		if (!raw) return DEFAULT_CHORD;
		const parsed = JSON.parse(raw) as Partial<Chord> & { key?: string };
		// A chord saved before the switch to `code` carries the character it
		// was typed with; a letter or a digit maps back to one physical key.
		const code =
			typeof parsed.code === 'string'
				? parsed.code
				: typeof parsed.key === 'string'
					? codeOf(parsed.key.toLowerCase())
					: undefined;
		if (!code) return DEFAULT_CHORD;
		return {
			code,
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
		event.code === chord.code &&
		event.altKey === chord.alt &&
		event.ctrlKey === chord.ctrl &&
		event.shiftKey === chord.shift &&
		event.metaKey === chord.meta
	);
}

/** What a physical key is called on a legend: `KeyB` is B, `Digit1` is 1. */
function keyLabel(code: string): string {
	const named = /^(?:Key|Digit)(.)$/.exec(code);
	return named ? named[1] : code;
}

/** Human-readable, in the order a keyboard legend writes them. */
export function chordLabel(c: Chord): string {
	const parts: string[] = [];
	if (c.ctrl) parts.push('Ctrl');
	if (c.alt) parts.push('Alt');
	if (c.shift) parts.push('Shift');
	if (c.meta) parts.push('Cmd');
	parts.push(keyLabel(c.code));
	return parts.join('+');
}

/**
 * Why this chord cannot be used, or null when it can.
 *
 * The chords listed here are the ones the browser or the OS eats before the
 * page ever sees them, so binding one would leave the rider pressing a key
 * that silently does nothing. A refusal is checked against EVERY platform,
 * not the one in front of the rider: a chord set on the Mac in the living
 * room has to still work on the Windows machine in the garage.
 *
 * Saying which chord and which platform is the whole point (errors.md) —
 * "that chord cannot be used" teaches nothing.
 */
export function refuseChord(c: Chord): string | null {
	if (!c.alt && !c.ctrl && !c.meta) {
		// A bare letter on the window is the bug this module exists to fix,
		// whoever asks for it.
		return 'That chord needs Alt, Ctrl or Cmd — a bare key would fire the board while you were doing something else.';
	}
	const label = chordLabel(c);
	if (/^Digit[1-9]$/.test(c.code)) {
		if (c.meta)
			return `${label} switches browser tabs on macOS. Pick another chord.`;
		if (c.ctrl)
			return `${label} switches browser tabs on Windows and Linux. Pick another chord.`;
		if (c.alt)
			return `${label} switches browser tabs in Firefox, and in Chrome on Windows and Linux. Pick another chord.`;
	}
	// The handful no browser will ever hand over, on any platform.
	const HELD_BY_THE_BROWSER: Record<string, string> = {
		KeyW: 'closes the tab',
		KeyT: 'opens a new tab',
		KeyN: 'opens a new window',
		KeyQ: 'quits the browser',
	};
	const taken = HELD_BY_THE_BROWSER[c.code];
	if (taken && (c.ctrl || c.meta) && !c.alt && !c.shift) {
		return `${label} ${taken} — the browser takes it before WattRoom sees it. Pick another chord.`;
	}
	return null;
}

export const toggleKey = {
	get chord() {
		return chord;
	},
	get label() {
		return chordLabel(chord);
	},
	/** Takes the chord, or returns why it cannot have it. */
	set(next: Chord): string | null {
		const refusal = refuseChord(next);
		if (refusal) return refusal;
		chord = { ...next };
		try {
			globalThis.localStorage?.setItem(KEY, JSON.stringify(chord));
		} catch {
			// device-only preference; losing it costs one rebind
		}
		return null;
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
