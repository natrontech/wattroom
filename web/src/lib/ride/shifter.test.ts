import { describe, expect, it } from 'vitest';
import { createShifter, type ShiftDir, type ShiftEvent } from './shifter';

/** A cassette of `gears`, starting in `gear`, that takes the shifter's moves. */
function bike(gears = 24, gear = 12) {
	const state = { gear };
	const shifter = createShifter((dir) =>
		dir > 0 ? state.gear >= gears : state.gear <= 1,
	);
	const events: ShiftEvent[] = [];
	const take = (out: ShiftEvent[]) => {
		for (const e of out) {
			events.push(e);
			if (e.kind === 'shift') state.gear += e.dir;
		}
	};
	/** Advance time in 10 ms ticks, as a ride's frame loop would. */
	let now = 0;
	const until = (at: number) => {
		for (; now <= at; now += 10) take(shifter.tick(now));
		now = at;
	};
	return {
		state,
		events,
		shifts: () => events.filter((e) => e.kind === 'shift'),
		ends: () => events.filter((e) => e.kind === 'end'),
		press(dir: ShiftDir, at: number, source = 'keys') {
			until(at);
			take(shifter.press(dir, at, source));
		},
		release(at: number, source = 'keys') {
			until(at);
			shifter.release(source, at);
		},
		/** A tap: down and up in the same instant, as a click or the phone sends it. */
		tap(dir: ShiftDir, at: number, source = 'keys') {
			until(at);
			take(shifter.press(dir, at, source));
			shifter.release(source, at);
		},
		drop(at: number, source: string) {
			until(at);
			shifter.drop(source);
		},
		until,
	};
}

describe('the shifter (docs/SPEC.md, ADR-0084)', () => {
	it('counts a switch bouncing at 20 ms as one press, and two sources as two', () => {
		const b = bike();
		b.press(1, 0);
		b.release(10);
		b.press(1, 20); // the bounce
		b.release(80);
		b.tap(1, 300, 'phone');
		b.tap(1, 310, 'keys'); // another source, inside the first's rate
		b.until(1000);
		expect(b.shifts().map((e) => e.at)).toEqual([0, 300, 400]);
	});

	it('gives 5 taps in 250 ms 5 shifts, each at least 100 ms apart', () => {
		const b = bike();
		for (let i = 0; i < 5; i++) b.tap(1, i * 62.5);
		b.until(2000);
		const at = b.shifts().map((e) => e.at);
		expect(at).toHaveLength(5);
		for (let i = 1; i < at.length; i++)
			expect(at[i] - at[i - 1]).toBeGreaterThanOrEqual(100); // SPEC's rate, not the constant
	});

	it('gives a flood of 20 presses 45 ms apart fewer than 20 shifts', () => {
		const b = bike(60, 30);
		for (let i = 0; i < 20; i++) b.tap(1, i * 45);
		b.until(3000);
		expect(b.shifts().length).toBeLessThan(20);
	});

	it('lets an opposite press cancel a queued one', () => {
		const b = bike();
		b.tap(1, 0);
		b.tap(1, 50); // queued behind the rate
		b.tap(-1, 95, 'phone'); // cancels it
		b.until(1000);
		expect(b.shifts().map((e) => [e.dir, e.at])).toEqual([[1, 0]]);
		expect(b.state.gear).toBe(13);
	});

	it('repeats a 1 s hold at 0, 400, 600 and 800 ms', () => {
		const b = bike();
		b.press(1, 0);
		b.release(999);
		b.until(2000);
		expect(b.shifts().map((e) => e.at)).toEqual([0, 400, 600, 800]);
	});

	it('plays one end cue per press at either end, and none for a repeat', () => {
		const b = bike(24, 24);
		b.press(1, 0);
		b.release(50);
		b.press(1, 200);
		b.release(1200); // held: repeats at 600, 800, 1000 are silent
		const top = b.ends();
		expect(top.map((e) => e.at)).toEqual([0, 200]);
		expect(b.shifts()).toEqual([]);

		const low = bike(24, 1);
		low.press(-1, 0);
		low.release(50);
		expect(low.ends().map((e) => e.dir)).toEqual([-1]);
	});

	it('stops a dropped source repeating', () => {
		const b = bike();
		b.press(1, 0, 'controller');
		b.drop(450, 'controller'); // disconnected while held
		b.until(2000);
		expect(b.shifts().map((e) => e.at)).toEqual([0, 400]);
	});

	// Why the phone sends taps, not holds (SPEC "Phone"): a hold relayed over
	// a socket whose release is lost repeats until the relay's 1 s timeout
	// drops the source; a tap carries its own release.
	it('makes up to 5 phantom shifts from a relayed hold whose release is lost, none from a tap', () => {
		const hold = bike();
		hold.press(1, 0, 'phone');
		// The release at 399 never arrives; the relay drops the source 1 s later.
		hold.drop(1399, 'phone');
		hold.until(3000);
		const phantom = hold.shifts().filter((e) => e.at > 399);
		expect(phantom.map((e) => e.at)).toEqual([400, 600, 800, 1000, 1200]);

		const tap = bike();
		tap.press(1, 0, 'phone');
		tap.release(0, 'phone'); // in the same message
		tap.until(3000);
		expect(tap.shifts().map((e) => e.at)).toEqual([0]);
	});
});
