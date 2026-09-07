import { beforeEach, describe, expect, it } from 'vitest';
import {
	chordLabel,
	DEFAULT_CHORD,
	isToggle,
	toggleKey,
} from '$lib/board/toggle-key.svelte';

// isToggle reads five fields, so a literal is a truer stand-in than a DOM
// event this environment does not have.
const press = (init: {
	key: string;
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

describe('the board toggle chord', () => {
	beforeEach(() => toggleKey.reset());

	it('defaults to a modifier, so a bare letter never fires it', () => {
		expect(isToggle(press({ key: 'b' }))).toBe(false);
		expect(isToggle(press({ key: 'b', altKey: true }))).toBe(true);
	});

	it('ignores case, so shift-lock does not lose the board', () => {
		expect(isToggle(press({ key: 'B', altKey: true }))).toBe(true);
	});

	it('does not fire when extra modifiers are held', () => {
		expect(isToggle(press({ key: 'b', altKey: true, ctrlKey: true }))).toBe(
			false,
		);
	});

	it('refuses a chord with no modifier — that is the bug it exists to fix', () => {
		expect(toggleKey.set({ ...DEFAULT_CHORD, alt: false })).toBe(false);
		expect(toggleKey.chord.alt).toBe(true);
	});

	it('takes a chord the rider chooses, and reads it back', () => {
		expect(
			toggleKey.set({
				key: 'K',
				alt: false,
				ctrl: true,
				shift: false,
				meta: false,
			}),
		).toBe(true);
		expect(isToggle(press({ key: 'k', ctrlKey: true }))).toBe(true);
		expect(isToggle(press({ key: 'b', altKey: true }))).toBe(false);
		expect(toggleKey.label).toBe('Ctrl+K');
	});

	it('writes a legend in keyboard order', () => {
		expect(
			chordLabel({ key: 'b', alt: true, ctrl: true, shift: true, meta: true }),
		).toBe('Ctrl+Alt+Shift+Cmd+B');
	});
});
