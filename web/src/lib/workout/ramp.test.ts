import { describe, expect, it } from 'vitest';
import { SimulatedTrainer } from '$lib/ble/simulated';
import { durationSeconds, flatten, targetAt } from './engine';
import { createRideSession, DEFAULTS } from './session.svelte';
import {
	bestOneMinute,
	buildRampTest,
	ftpFromRamp,
	RAMP,
	rampBlown,
	rampFailed,
	rampUsable,
} from './ramp';

// The warm-up has a target too (35→50 % FTP), so the raw detector would end a
// test five seconds in on a rider still spinning up. The page asks this one.
describe('rampBlown', () => {
	const stalled = Array.from({ length: RAMP.failSeconds }, () => ({
		watts: 0,
		target: 70,
	}));
	it('never trips during the warm-up', () => {
		expect(rampBlown(5, stalled)).toBe(false);
		expect(rampBlown(RAMP.warmupSeconds - 1, stalled)).toBe(false);
	});
	it('trips once a step has a real target', () => {
		expect(rampBlown(RAMP.warmupSeconds + 30, stalled)).toBe(true);
	});
});
import { validateWorkout } from './validate';

describe('buildRampTest', () => {
	it('is a valid workout the normal engine can run', () => {
		const workout = buildRampTest();
		expect(validateWorkout(workout).ok).toBe(true);
		expect(durationSeconds(workout)).toBe(300 + RAMP.steps * RAMP.stepSeconds);
	});

	it('steps by 20 W a minute from 100 W, in absolute watts', () => {
		const segments = flatten(buildRampTest());
		// FTP is irrelevant to a ramp: the targets must not scale with it.
		const atAnyFtp = (ftp: number, second: number) =>
			targetAt(segments, ftp, second).targetWatts;
		expect(atAnyFtp(200, 300)).toBe(100); // first step, straight after warmup
		expect(atAnyFtp(400, 300)).toBe(100); // same number for a stronger rider
		expect(atAnyFtp(200, 360)).toBe(120);
		expect(atAnyFtp(200, 300 + 10 * 60)).toBe(300);
	});
});

describe('bestOneMinute', () => {
	it('is zero for no ride', () => {
		expect(bestOneMinute([])).toBe(0);
	});

	it('averages over what exists when the ride is under a minute', () => {
		expect(bestOneMinute([200, 200, 200])).toBe(200);
	});

	/**
	 * The reason this is a rolling window. A rider fails partway through a step, so
	 * their best minute straddles the boundary — taking the last completed step
	 * would under-report by up to a full increment.
	 */
	it('finds a best minute that straddles two steps', () => {
		const watts = [
			...Array(30).fill(280), // second half of the 280 W step
			...Array(30).fill(300), // first half of the 300 W step, then they blow
			...Array(30).fill(120),
		];
		expect(bestOneMinute(watts)).toBe(290);
	});

	it('ignores a dying tail', () => {
		const watts = [...Array(60).fill(300), ...Array(60).fill(50)];
		expect(bestOneMinute(watts)).toBe(300);
	});
});

describe('ftpFromRamp', () => {
	it('is 75 % of the best minute', () => {
		expect(ftpFromRamp(Array(60).fill(400))).toEqual({ best: 400, ftp: 300 });
	});

	it('reports zero rather than NaN for an empty ride', () => {
		expect(ftpFromRamp([])).toEqual({ best: 0, ftp: 0 });
	});
});

describe('rampFailed', () => {
	const at = (watts: number, target: number) => ({ watts, target });

	it('is false while the rider is holding the step', () => {
		expect(rampFailed(Array(10).fill(at(300, 300)))).toBe(false);
	});

	it('is false for a brief dip', () => {
		expect(
			rampFailed([...Array(8).fill(at(300, 300)), at(150, 300), at(300, 300)]),
		).toBe(false);
	});

	it('is true once power has sat well under target for the full window', () => {
		expect(rampFailed(Array(RAMP.failSeconds).fill(at(150, 300)))).toBe(true);
	});

	it('needs a full window before deciding, so a slow start is not a failure', () => {
		expect(rampFailed([at(0, 300), at(0, 300)])).toBe(false);
	});
});

describe('rampUsable', () => {
	/**
	 * FTP scales every workout, so a number derived from a warmup is not merely
	 * imprecise — accepting it makes the whole library wrong.
	 */
	it('rejects a test abandoned during the warmup', () => {
		expect(rampUsable(24)).toBe(false);
		expect(rampUsable(RAMP.warmupSeconds)).toBe(false);
	});

	it('rejects a single step, which is not a ramp', () => {
		expect(rampUsable(RAMP.warmupSeconds + RAMP.stepSeconds)).toBe(false);
	});

	it('accepts once enough steps are done to have measured something', () => {
		expect(
			rampUsable(RAMP.warmupSeconds + RAMP.minSteps * RAMP.stepSeconds),
		).toBe(true);
		expect(rampUsable(RAMP.warmupSeconds + 12 * RAMP.stepSeconds)).toBe(true);
	});
});

describe('a ramp the rider stops in', () => {
	// #792: the ramp ends when the rider blows, which means five seconds well
	// under target. Auto-pause releases the actuator target to zero after
	// three, and `rampFailed` rejects a zero target — so the page, reading the
	// actuator, never saw a failure and the rider sat auto-paused instead of
	// being given their FTP.
	async function stopMidRamp() {
		const trainer = new SimulatedTrainer();
		const session = createRideSession({
			trainer,
			workout: buildRampTest(),
			ftp: 200,
		});
		await session.start();
		// Past the warmup and into a step, so there is a real target to fail.
		for (let i = 0; i < RAMP.warmupSeconds + 30; i++) {
			session.onSample({ watts: 150, cadence: 90, at: i * 1000 });
			session.tick();
		}
		// Then the rider stops: long enough to auto-pause AND to fail.
		// One sample per wall-clock second, as a trainer sends them: the record
		// admits a second once (#1456), so the stop has to keep the clock going.
		for (let i = 0; i < DEFAULTS.pauseAfterSeconds + RAMP.failSeconds; i++) {
			session.onSample({
				watts: 0,
				cadence: 0,
				at: (RAMP.warmupSeconds + 30 + i) * 1000,
			});
			session.tick();
		}
		return session;
	}

	const trailing = (
		session: Awaited<ReturnType<typeof stopMidRamp>>,
		target: number,
	) =>
		session.recording
			.slice(-RAMP.failSeconds)
			.map((s) => ({ watts: s.watts, target }));

	it('finishes against the prescribed target', async () => {
		const session = await stopMidRamp();
		expect(session.state).toBe('autopaused');
		expect(session.info.targetWatts).toBeGreaterThan(0);
		expect(rampFailed(trailing(session, session.info.targetWatts ?? 0))).toBe(
			true,
		);
		session.stop();
	});

	it('never finishes against the released one', async () => {
		const session = await stopMidRamp();
		expect(session.target).toBe(0);
		expect(rampFailed(trailing(session, session.target))).toBe(false);
		session.stop();
	});
});
