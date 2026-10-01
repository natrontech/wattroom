import { isTyping } from '$lib/keys';
import { createRideShift } from '$lib/ride/ride-shift';
import type { ShiftDir, ShiftDriver } from '$lib/ride/shifter';

/**
 * Easier / Harder from the keyboard (ADR-0084, #3329), and from anything that
 * arrives as one: a presentation clicker, a foot switch, an 8BitDo Micro in
 * keyboard mode, BikeControl's keystroke presets. A browser cannot tell a
 * clicker from the laptop's own keyboard, so they are one input. Rouvy and
 * TrainingPeaks Virtual shift on , . - + too, so their presets drive this
 * unchanged. docs/SPEC.md "Keys"; the ride keymap (#3216) extends this module.
 */
const HARDER = ['.', '+', '=', 'PageUp'];
const EASIER = [',', '-', 'PageDown'];

/** A key a ride shifts with, so the soundboard yields it while one does. */
export function shiftsGears(key: string): boolean {
	return HARDER.includes(key) || EASIER.includes(key);
}

/**
 * The shift a key asks for: 1 Harder, −1 Easier, null for any other. By
 * `key`, so a Swiss-German + (Shift+1) shifts; the keypad by `code`. Never
 * with Cmd, Ctrl or Alt: Cmd/Ctrl+= is the shell's zoom (#3016).
 */
export function shiftOf(
	event: Pick<KeyboardEvent, 'key' | 'code' | 'metaKey' | 'ctrlKey' | 'altKey'>,
): ShiftDir | null {
	if (event.metaKey || event.ctrlKey || event.altKey) return null;
	if (event.code === 'NumpadAdd' || HARDER.includes(event.key)) return 1;
	if (event.code === 'NumpadSubtract' || EASIER.includes(event.key)) return -1;
	return null;
}

/**
 * The keys, bound to a shifter while a ride shifts. Keydown and keyup are
 * press and release — `event.repeat` is ignored, the shifter repeats — and a
 * keyup lost to a focus change never leaves a repeat running: a blurred
 * window or a hidden tab releases every held key.
 */
export function bindShiftKeys(
	driver: Pick<ShiftDriver, 'press' | 'release' | 'drop'>,
): () => void {
	const held = new Set<string>();
	const down = (event: KeyboardEvent) => {
		if (event.defaultPrevented || isTyping(event)) return;
		const dir = shiftOf(event);
		if (dir === null) return;
		// PgUp / PgDn are Harder / Easier, never a page (docs/SPEC.md).
		event.preventDefault();
		if (event.repeat) return;
		const source = `key:${event.code}`;
		held.add(source);
		driver.press(dir, source);
	};
	// By code: a Shift+1 whose Shift came up first is key "1" on the way up.
	const up = (event: KeyboardEvent) => {
		const source = `key:${event.code}`;
		if (held.delete(source)) driver.release(source);
	};
	const releaseAll = () => {
		for (const source of held) driver.drop(source);
		held.clear();
	};
	window.addEventListener('keydown', down);
	window.addEventListener('keyup', up);
	window.addEventListener('blur', releaseAll);
	document.addEventListener('visibilitychange', releaseAll);
	return () => {
		releaseAll();
		window.removeEventListener('keydown', down);
		window.removeEventListener('keyup', up);
		window.removeEventListener('blur', releaseAll);
		document.removeEventListener('visibilitychange', releaseAll);
	};
}

/** The keys shifting one ride, each move one Easier / Harder press (#3328). */
export function bindRideShift(
	ride: Parameters<typeof createRideShift>[0],
): () => void {
	const driver = createRideShift(ride);
	const unbind = bindShiftKeys(driver);
	return () => {
		unbind();
		driver.stop();
	};
}
