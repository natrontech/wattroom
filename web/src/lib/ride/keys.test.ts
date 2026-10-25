// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	bindRideKeys,
	bindShiftKeys,
	createRemoteRunner,
	rideKeyOf,
	shiftOf,
	shiftsGears,
	TALK_KEEPALIVE_MS,
} from './keys';
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
			(event) => moves.push(event.dir),
			() => false,
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

describe('the phone remote (#3217)', () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	const rig = () => {
		const driver = { press: vi.fn(), release: vi.fn() };
		const talk = vi.fn();
		const page = vi.fn();
		return {
			driver,
			talk,
			page,
			...createRemoteRunner(driver, talk, { page }),
		};
	};

	it('shifts with a tap: a press and its release together', () => {
		const { driver, run } = rig();
		run({ action: 'harder' });
		run({ action: 'easier' });
		expect(driver.press.mock.calls).toEqual([
			[1, 'remote'],
			[-1, 'remote'],
		]);
		expect(driver.release).toHaveBeenCalledTimes(2);
	});

	it('runs the other keymap actions it is given and ignores the rest', () => {
		const { page, run } = rig();
		run({ action: 'page' });
		run({ action: 'camera' });
		expect(page).toHaveBeenCalledTimes(1);
	});

	it('lets go of Talk 1 s after the last beat, not before', () => {
		const { talk, run } = rig();
		run({ action: 'talk-down' });
		vi.advanceTimersByTime(TALK_KEEPALIVE_MS - 100);
		run({ action: 'talk-keepalive' });
		vi.advanceTimersByTime(TALK_KEEPALIVE_MS - 100);
		expect(talk).toHaveBeenLastCalledWith(true);
		vi.advanceTimersByTime(200);
		expect(talk).toHaveBeenLastCalledWith(false);
		expect(vi.getTimerCount()).toBe(0);
	});

	it('lets go of Talk at once on talk-up, and a late beat does not reopen it', () => {
		const { talk, run } = rig();
		run({ action: 'talk-down' });
		run({ action: 'talk-up' });
		expect(talk).toHaveBeenLastCalledWith(false);
		talk.mockClear();
		run({ action: 'talk-keepalive' });
		vi.advanceTimersByTime(TALK_KEEPALIVE_MS * 2);
		expect(talk).not.toHaveBeenCalled();
	});
});

describe('the ride keys (#3216)', () => {
	const press = (init: KeyboardEventInit) =>
		rideKeyOf({
			metaKey: false,
			ctrlKey: false,
			altKey: false,
			shiftKey: false,
			key: '',
			...init,
		});

	it.each([
		['1', { kind: 'camera', preset: 'chase' }],
		['4', { kind: 'camera', preset: 'steady' }],
		['h', { kind: 'clean' }],
		['H', { kind: 'clean' }],
		['m', { kind: 'map' }],
		['o', { kind: 'snap' }],
		['?', { kind: 'sheet' }],
	])('%s is a ride key', (k, want) => {
		expect(press({ key: k, shiftKey: k === '?' })).toEqual(want);
	});

	it.each([
		// Push-to-talk, the divider, editKeys and the page keys.
		{ key: ' ' },
		{ key: 'ArrowLeft' },
		{ key: 'ArrowRight' },
		{ key: 'PageUp' },
		{ key: 'PageDown' },
		// The shift keys, and Swiss-German + (Shift+1).
		{ key: '.' },
		{ key: '+', shiftKey: true },
		{ key: '5' },
		{ key: 'h', metaKey: true },
		{ key: '1', ctrlKey: true },
	])('leaves %o alone', (init) => {
		expect(press(init)).toBeNull();
	});

	it('no ride key is a shift key', () => {
		for (const k of ['1', '2', '3', '4', 'h', 'm', 'o', '?', ' '])
			expect(shiftsGears(k)).toBe(false);
	});

	describe('bound to the window', () => {
		const acts: string[] = [];
		let off: () => void;
		let bound = false;
		beforeEach(() => {
			acts.length = 0;
			bound = false;
			off = bindRideKeys(
				(k) => acts.push(k.kind),
				() => bound,
			);
		});
		afterEach(() => off());
		const fire = (init: KeyboardEventInit, target: EventTarget = window) => {
			const e = new KeyboardEvent('keydown', {
				bubbles: true,
				cancelable: true,
				...init,
			});
			target.dispatchEvent(e);
			return e;
		};

		it('acts on h and swallows it', () => {
			expect(fire({ key: 'h' }).defaultPrevented).toBe(true);
			expect(acts).toEqual(['clean']);
		});
		it('skips a typing target, a repeat and a handled event', () => {
			const input = document.createElement('input');
			document.body.append(input);
			fire({ key: 'h' }, input);
			fire({ key: 'h', repeat: true });
			window.addEventListener('keydown', (e) => e.preventDefault(), {
				once: true,
				capture: true,
			});
			fire({ key: 'h' });
			expect(acts).toEqual([]);
			input.remove();
		});
		it('yields a key a soundboard pad is bound to', () => {
			bound = true;
			expect(fire({ key: '2' }).defaultPrevented).toBe(false);
			expect(acts).toEqual([]);
		});
	});
});
