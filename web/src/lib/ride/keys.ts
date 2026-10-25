import { isTyping } from '$lib/keys';
import { gearsEnabled } from '$lib/ride/gears-enabled';
import { createRideShift } from '$lib/ride/ride-shift';
import type { ShiftDir, ShiftDriver } from '$lib/ride/shifter';
import type { RemoteCommand } from '$lib/protocol';

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

/**
 * A key a ride shifts with, so the soundboard yields it while one does.
 * None while the keys' switch is off (ADR-0084 "Inputs").
 */
export function shiftsGears(key: string): boolean {
	return gearsEnabled('keys') && (HARDER.includes(key) || EASIER.includes(key));
}

/**
 * The shift a key asks for: 1 Harder, −1 Easier, null for any other. By
 * `key`, so a Swiss-German + (Shift+1) shifts; the keypad by `code`. Never
 * with Cmd, Ctrl or Alt: Cmd/Ctrl+= is the shell's zoom (#3016), and none
 * while the keys' switch is off.
 */
export function shiftOf(
	event: Pick<KeyboardEvent, 'key' | 'code' | 'metaKey' | 'ctrlKey' | 'altKey'>,
): ShiftDir | null {
	if (event.metaKey || event.ctrlKey || event.altKey) return null;
	if (!gearsEnabled('keys')) return null;
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

/** Talk's hold ends this long after the last beat from the phone (#3217). */
export const TALK_KEEPALIVE_MS = 1000;

/**
 * What a phone remote's press does here (#3217): the same inputs the keys
 * reach, so a command and its key are one path. Easier and Harder are taps,
 * never holds, because a lost release measured up to 5 phantom shifts. Talk
 * is held and lets go by itself when the phone goes quiet for a second; the
 * hub sends talk-up at once when the phone's socket drops. Actions with no
 * handler (the other keymap actions, #3216) do nothing.
 *
 * A ride that does not shift takes Easier and Harder as its bias trim
 * (#4163): with gears off the phone labels them Bias − and +, and the
 * shifter is never bound there.
 */
export function createRemoteRunner(
	driver: Pick<ShiftDriver, 'press' | 'release'> & {
		/** The shifter takes the tap: this ride shifts. */
		shifts(): boolean;
		/** The bias trim's one step, for a ride that does not shift. */
		trim(dir: ShiftDir): void;
	},
	talk: (held: boolean) => void,
	others: Partial<Record<string, () => void>> = {},
) {
	let watchdog: ReturnType<typeof setTimeout> | undefined;
	const stopTalk = () => {
		clearTimeout(watchdog);
		watchdog = undefined;
		talk(false);
	};
	const beat = () => {
		clearTimeout(watchdog);
		watchdog = setTimeout(stopTalk, TALK_KEEPALIVE_MS);
	};
	return {
		run({ action }: RemoteCommand) {
			switch (action) {
				case 'easier':
				case 'harder': {
					const dir: ShiftDir = action === 'harder' ? 1 : -1;
					if (!driver.shifts()) {
						driver.trim(dir);
						break;
					}
					driver.press(dir, 'remote');
					driver.release('remote');
					break;
				}
				case 'talk-down':
					talk(true);
					beat();
					break;
				case 'talk-keepalive':
					// A beat with no hold running is a stale one: the release
					// already landed, and it must not reopen the mic.
					if (watchdog) beat();
					break;
				case 'talk-up':
					stopTalk();
					break;
				default:
					others[action]?.();
			}
		},
		stop: stopTalk,
	};
}

/** 1-4, in the order the key sheet lists them (#3216). */
export const CAMERA_PRESETS = ['chase', 'heli', 'side', 'steady'] as const;
export type CameraPreset = (typeof CAMERA_PRESETS)[number];

export type RideKey =
	| { kind: 'camera'; preset: CameraPreset }
	| { kind: 'clean' | 'map' | 'snap' | 'sheet' };

/**
 * The ride key a press asks for, by `key` so a layout that types ? with Shift
 * still gets it. Never with Cmd, Ctrl or Alt. Arrows, Space and the shift keys
 * are not ride keys: the pane divider, the graph's editKeys, push-to-talk and
 * the shifter keep them.
 */
export function rideKeyOf(
	event: Pick<
		KeyboardEvent,
		'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'
	>,
): RideKey | null {
	if (event.metaKey || event.ctrlKey || event.altKey) return null;
	if (event.key === '?') return { kind: 'sheet' };
	// A Shift+digit is a symbol on most layouts (Swiss-German + is Shift+1).
	if (event.shiftKey) return null;
	const n = Number(event.key);
	if (event.key.length === 1 && n >= 1 && n <= CAMERA_PRESETS.length)
		return { kind: 'camera', preset: CAMERA_PRESETS[n - 1] };
	switch (event.key.toLowerCase()) {
		case 'h':
			return { kind: 'clean' };
		case 'm':
			return { kind: 'map' };
		case 'o':
			return { kind: 'snap' };
	}
	return null;
}

/**
 * The ride keys, while a ride runs. A press skips a typing target and a
 * `defaultPrevented` event, and yields a key a soundboard pad is bound to
 * (`padBound`), as the narrator's S does.
 */
export function bindRideKeys(
	act: (key: RideKey) => void,
	padBound: (key: string) => boolean,
): () => void {
	const down = (event: KeyboardEvent) => {
		if (event.defaultPrevented || event.repeat || isTyping(event)) return;
		const key = rideKeyOf(event);
		if (!key || padBound(event.key)) return;
		event.preventDefault();
		act(key);
	};
	window.addEventListener('keydown', down);
	return () => window.removeEventListener('keydown', down);
}
