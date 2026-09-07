// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	chordLabel,
	DEFAULT_CHORD,
	isToggle,
	refuseChord,
	toggleKey,
} from '$lib/board/toggle-key.svelte';

// isToggle reads five fields, so a literal is a truer stand-in than a DOM
// event this environment does not have. It carries `key` as well as `code`
// because the gap between the two is the bug this file now pins (#982): a
// literal built from `key` alone was what let the macOS default ship dead.
const press = (init: {
	code: string;
	key?: string;
	altKey?: boolean;
	ctrlKey?: boolean;
	shiftKey?: boolean;
	metaKey?: boolean;
}) =>
	({
		altKey: false,
		ctrlKey: false,
		shiftKey: false,
		metaKey: false,
		...init,
	}) as KeyboardEvent;

const chord = (over: Partial<typeof DEFAULT_CHORD>) => ({
	...DEFAULT_CHORD,
	...over,
});

describe('the board toggle chord', () => {
	beforeEach(() => toggleKey.reset());

	it('defaults to a modifier, so a bare letter never fires it', () => {
		expect(isToggle(press({ code: 'KeyB', key: 'b' }))).toBe(false);
		expect(isToggle(press({ code: 'KeyB', key: 'b', altKey: true }))).toBe(
			true,
		);
	});

	// The whole reason the chord moved to `code` (#982). macOS composes a
	// character for Option+letter, so the browser sends `key: "∫"` and the
	// shipped default matched nothing at all on every Mac.
	it('fires on a macOS Option+B, which never delivers the letter', () => {
		expect(isToggle(press({ code: 'KeyB', key: '∫', altKey: true }))).toBe(
			true,
		);
	});

	it('ignores the character entirely — shift-lock cannot lose the board', () => {
		expect(isToggle(press({ code: 'KeyB', key: 'B', altKey: true }))).toBe(
			true,
		);
	});

	it('does not fire when extra modifiers are held', () => {
		expect(
			isToggle(press({ code: 'KeyB', key: 'b', altKey: true, ctrlKey: true })),
		).toBe(false);
	});

	it('refuses a chord with no modifier — that is the bug it exists to fix', () => {
		expect(toggleKey.set(chord({ alt: false }))).toMatch(/Alt, Ctrl or Cmd/);
		expect(toggleKey.chord.alt).toBe(true);
	});

	it('takes a chord the rider chooses, and reads it back', () => {
		expect(
			toggleKey.set({
				code: 'KeyK',
				alt: false,
				ctrl: true,
				shift: false,
				meta: false,
			}),
		).toBeNull();
		expect(isToggle(press({ code: 'KeyK', key: 'k', ctrlKey: true }))).toBe(
			true,
		);
		expect(isToggle(press({ code: 'KeyB', key: 'b', altKey: true }))).toBe(
			false,
		);
		expect(toggleKey.label).toBe('Ctrl+K');
	});

	it('writes a legend in keyboard order, from the physical key', () => {
		expect(
			chordLabel({
				code: 'KeyB',
				alt: true,
				ctrl: true,
				shift: true,
				meta: true,
			}),
		).toBe('Ctrl+Alt+Shift+Cmd+B');
		expect(chordLabel(chord({ code: 'Digit1' }))).toBe('Alt+1');
	});
});

// Every row is refused on EVERY platform, not the one running the test: a
// chord set on a Mac has to keep working on the Windows machine in the garage.
describe('chords the browser or the OS eats first', () => {
	beforeEach(() => toggleKey.reset());

	it('names the platform that takes a digit chord', () => {
		expect(
			refuseChord(chord({ code: 'Digit1', alt: false, meta: true })),
		).toMatch(/switches browser tabs on macOS/);
		expect(
			refuseChord(chord({ code: 'Digit1', alt: false, ctrl: true })),
		).toMatch(/Windows and Linux/);
		expect(refuseChord(chord({ code: 'Digit1' }))).toMatch(/Firefox/);
	});

	it('names what the browser does with the chord it never hands over', () => {
		expect(
			refuseChord({
				code: 'KeyW',
				alt: false,
				ctrl: true,
				shift: false,
				meta: false,
			}),
		).toMatch(/closes the tab/);
		expect(
			refuseChord({
				code: 'KeyQ',
				alt: false,
				ctrl: false,
				shift: false,
				meta: true,
			}),
		).toMatch(/quits the browser/);
	});

	it('leaves the chord alone when it refuses one', () => {
		expect(toggleKey.set(chord({ code: 'Digit1' }))).not.toBeNull();
		expect(toggleKey.label).toBe('Alt+B');
	});

	it('allows a plain modifier + letter, which is what the default is', () => {
		expect(refuseChord(DEFAULT_CHORD)).toBeNull();
		expect(refuseChord(chord({ code: 'KeyJ' }))).toBeNull();
	});
});

// Every rider who had already moved the chord has the pre-#982 shape in
// storage: the character they typed, with no `code` beside it.
describe('a chord stored before the switch to physical keys', () => {
	it('still fires, read back as the key the character came from', async () => {
		// This environment has no localStorage of its own; the module reads it
		// once at import, so the store has to be standing before the import.
		const stored = JSON.stringify({ key: 'k', alt: false, ctrl: true });
		vi.stubGlobal('localStorage', {
			getItem: (k: string) =>
				k === 'wattroom.board.toggle.v1' ? stored : null,
			setItem: () => {},
			removeItem: () => {},
		});
		vi.resetModules();
		const fresh = await import('$lib/board/toggle-key.svelte');
		expect(fresh.toggleKey.label).toBe('Ctrl+K');
		expect(
			fresh.isToggle({
				code: 'KeyK',
				key: 'k',
				altKey: false,
				ctrlKey: true,
				shiftKey: false,
				metaKey: false,
			} as KeyboardEvent),
		).toBe(true);
		vi.unstubAllGlobals();
	});
});
