// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bindShiftKeys, shiftOf, shiftsGears } from './keys';
import { createShiftDriver, SHIFTER } from './shifter';

const key = (init: KeyboardEventInit) => ({
	key: '',
	code: '',
	metaKey: false,
	ctrlKey: false,
	altKey: false,
	...init,
});

describe('the shift keys (#3329)', () => {
	it.each([
		[{ key: '.', code: 'Period' }, 1],
		[{ key: '+', code: 'Equal', shiftKey: true }, 1],
		[{ key: '=', code: 'Equal' }, 1],
		[{ key: '+', code: 'NumpadAdd' }, 1],
		[{ key: 'PageUp', code: 'PageUp' }, 1],
		[{ key: ',', code: 'Comma' }, -1],
		[{ key: '-', code: 'Minus' }, -1],
		[{ key: '-', code: 'NumpadSubtract' }, -1],
		[{ key: 'PageDown', code: 'PageDown' }, -1],
		// Swiss-German: + is Shift+1. It shifts, and is not a digit.
		[{ key: '+', code: 'Digit1', shiftKey: true }, 1],
	] as const)('shifts on %o', (init, dir) => {
		expect(shiftOf(key(init))).toBe(dir);
	});

	it.each([
		// Push-to-talk, the divider's arrows and the graph's editKeys.
		{ key: ' ', code: 'Space' },
		{ key: 'ArrowLeft', code: 'ArrowLeft' },
		{ key: 'ArrowRight', code: 'ArrowRight' },
		{ key: 'ArrowUp', code: 'ArrowUp' },
		{ key: 'ArrowDown', code: 'ArrowDown' },
		{ key: 'ArrowRight', code: 'ArrowRight', altKey: true },
		// Cmd/Ctrl+= is the shell's zoom (#3016); Cmd+- its zoom out.
		{ key: '=', code: 'Equal', metaKey: true },
		{ key: '=', code: 'Equal', ctrlKey: true },
		{ key: '-', code: 'Minus', metaKey: true },
		// A pad's letter or digit.
		{ key: 'b', code: 'KeyB' },
		{ key: '1', code: 'Digit1' },
	])('leaves %o alone', (init) => {
		expect(shiftOf(key(init))).toBeNull();
	});

	it('names the keys the soundboard yields while a ride shifts, and only those', () => {
		for (const k of ['.', '+', '=', ',', '-', 'PageUp', 'PageDown'])
			expect(shiftsGears(k)).toBe(true);
		for (const k of ['a', '1', ' ', 'ArrowUp', '/', '*'])
			expect(shiftsGears(k)).toBe(false);
	});
});

describe('a held shift key', () => {
	let moves: number[];
	let unbind: () => void;
	beforeEach(() => {
		vi.useFakeTimers();
		moves = [];
		const driver = createShiftDriver(
			(dir) => moves.push(dir),
			() => Date.now(),
		);
		const off = bindShiftKeys(driver);
		unbind = () => {
			off();
			driver.stop();
		};
	});
	afterEach(() => {
		unbind();
		vi.useRealTimers();
	});

	const press = (init: KeyboardEventInit, type = 'keydown') =>
		window.dispatchEvent(
			new KeyboardEvent(type, { bubbles: true, cancelable: true, ...init }),
		);
	const plus = { key: '+', code: 'Equal', shiftKey: true };

	it("repeats through the shifter, not through the keyboard's auto-repeat", () => {
		press(plus);
		// The OS's auto-repeat, every 30 ms: none of it is a press.
		for (let t = 0; t < 10; t++) {
			vi.advanceTimersByTime(30);
			press({ ...plus, repeat: true });
		}
		expect(moves).toEqual([1]);
		vi.advanceTimersByTime(SHIFTER.holdMs - 300 + SHIFTER.repeatMs * 2);
		expect(moves).toEqual([1, 1, 1, 1]);
		press(plus, 'keyup');
		vi.advanceTimersByTime(1_000);
		expect(moves).toHaveLength(4);
	});

	it('stops repeating when the window loses focus mid-hold', () => {
		press(plus);
		vi.advanceTimersByTime(SHIFTER.holdMs);
		const held = moves.length;
		expect(held).toBeGreaterThan(1);
		window.dispatchEvent(new Event('blur'));
		vi.advanceTimersByTime(2_000);
		expect(moves).toHaveLength(held);
	});

	it('stops repeating when the tab is hidden mid-hold', () => {
		press(plus);
		vi.advanceTimersByTime(SHIFTER.holdMs);
		const held = moves.length;
		document.dispatchEvent(new Event('visibilitychange'));
		vi.advanceTimersByTime(2_000);
		expect(moves).toHaveLength(held);
	});

	it('does not shift from a field being typed in, or on Cmd+=', () => {
		const input = document.createElement('input');
		document.body.append(input);
		input.dispatchEvent(
			new KeyboardEvent('keydown', { bubbles: true, key: '+', code: 'Equal' }),
		);
		input.remove();
		press({ key: '=', code: 'Equal', metaKey: true });
		vi.advanceTimersByTime(1_000);
		expect(moves).toEqual([]);
	});

	it('keeps PgDn from paging, and yields to a handler that already took the key', () => {
		const pgdn = new KeyboardEvent('keydown', {
			key: 'PageDown',
			code: 'PageDown',
			cancelable: true,
		});
		window.dispatchEvent(pgdn);
		expect(pgdn.defaultPrevented).toBe(true);
		expect(moves).toEqual([-1]);
		const taken = new KeyboardEvent('keydown', {
			key: '.',
			code: 'Period',
			cancelable: true,
		});
		taken.preventDefault();
		vi.advanceTimersByTime(SHIFTER.minGapMs);
		window.dispatchEvent(taken);
		expect(moves).toEqual([-1]);
	});
});
