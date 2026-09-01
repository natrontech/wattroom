import { describe, expect, it } from 'vitest';
import { SimulatedTrainer } from '$lib/ble/simulated';
import {
	createRideSession,
	DEFAULTS,
	soloRide,
	toleranceBand,
} from './session.svelte';
import type { Workout } from './types';

const workout: Workout = {
	name: 'test',
	steps: [
		{ type: 'steady', seconds: 60, target: 1.0 },
		{ type: 'steady', seconds: 60, target: 0.5 },
	],
};

function ride() {
	const trainer = new SimulatedTrainer();
	const session = createRideSession({ trainer, workout, ftp: 200 });
	return session;
}

/** Feed one second of rider behaviour without waiting on a real clock. */
function pedal(
	session: ReturnType<typeof ride>,
	watts: number,
	cadence: number,
	seconds = 1,
) {
	for (let i = 0; i < seconds; i++) {
		session.onSample({ watts, cadence, at: i * 1000 });
		session.tick();
	}
}

describe('toleranceBand', () => {
	it('is ±5 % of target with a ±10 W floor', () => {
		expect(toleranceBand(300)).toBe(15);
		expect(toleranceBand(100)).toBe(10); // 5 % would be 5; the floor wins
	});
});

describe('createRideSession', () => {
	it('holds the workout target, scaled by FTP', async () => {
		const session = ride();
		await session.start();
		expect(session.target).toBe(200); // 100 % of a 200 W FTP
		session.stop();
	});

	it('scales the target by bias, clamped to the allowed range', async () => {
		const session = ride();
		await session.start();
		session.nudgeBias(0.05);
		expect(session.target).toBe(210);
		for (let i = 0; i < 100; i++) session.nudgeBias(0.05);
		expect(session.bias).toBe(DEFAULTS.biasMax);
		session.stop();
	});

	it('auto-pauses after the rider stops, and releases the target', async () => {
		const session = ride();
		await session.start();
		pedal(session, 0, 0, DEFAULTS.pauseAfterSeconds);
		expect(session.state).toBe('autopaused');
		expect(session.target).toBe(0);
		session.stop();
	});

	it('counts down before resuming rather than snapping back to target', async () => {
		const session = ride();
		await session.start();
		pedal(session, 0, 0, DEFAULTS.pauseAfterSeconds);
		session.onSample({ watts: 100, cadence: 85, at: 0 });
		expect(session.state).toBe('resuming');
		expect(session.resumeIn).toBe(DEFAULTS.resumeCountdown);
		for (let i = 0; i < DEFAULTS.resumeCountdown; i++) session.tick();
		expect(session.state).toBe('running');
		session.stop();
	});

	it('trips the spiral guard on collapsing cadence and releases the target', async () => {
		const session = ride();
		await session.start();
		pedal(session, 190, 40, DEFAULTS.spiralAfterSeconds);
		expect(session.spiralActive).toBe(true);
		expect(session.target).toBe(0);
		session.stop();
	});

	it('falls back to power collapse when there is no cadence source at all', async () => {
		// The Kickr v2 case: cadence is absent, not merely low (RESEARCH.md §9).
		const session = ride();
		await session.start();
		pedal(session, 60, 0, DEFAULTS.spiralAfterSeconds);
		expect(session.spiralActive).toBe(true);
		session.stop();
	});

	it('excludes auto-paused time from the execution score', async () => {
		const session = ride();
		await session.start();
		pedal(session, 200, 90, 5); // five seconds dead on target
		expect(session.execution).toBe(1);
		pedal(session, 0, 0, 10); // stopped: must not count as missed seconds
		expect(session.execution).toBe(1);
		session.stop();
	});

	it('skip jumps to the next block', async () => {
		const session = ride();
		await session.start();
		expect(session.target).toBe(200);
		session.skip();
		expect(session.target).toBe(100); // second block is 50 % FTP
		session.stop();
	});

	it('extend keeps the current block going', async () => {
		const session = ride();
		await session.start();
		pedal(session, 200, 90, 59);
		session.extend(30);
		expect(session.target).toBe(200); // still in block one rather than block two
		session.stop();
	});
});

describe('a throttled tick', () => {
	/**
	 * Chrome throttles a hidden tab's timers to about once a minute (#51). The ride
	 * has to absorb that: the clock advances by the seconds that really passed, so a
	 * rider who switched tabs comes back to the right place in the workout rather
	 * than a minute behind it.
	 */
	it('advances the ride by the seconds it covers, not by one', async () => {
		const session = ride();
		await session.start();

		session.tick(45);

		expect(session.elapsed).toBe(45);
		session.stop();
	});

	it('crosses a block boundary and lands on the new target', async () => {
		const session = ride();
		await session.start();
		expect(session.target).toBe(200);

		// One fire covering the whole first block plus a second of the next.
		session.tick(61);

		expect(session.target).toBe(100); // 50 % of a 200 W FTP
		session.stop();
	});

	it('finishes a workout that ended inside the gap', async () => {
		const session = ride();
		await session.start();

		session.tick(600);

		expect(session.state).toBe('done');
		session.stop();
	});

	it('does not leave the spiral guard held open past its release', async () => {
		const session = ride();
		await session.start();
		pedal(session, 40, 40, DEFAULTS.spiralAfterSeconds);
		expect(session.spiralActive).toBe(true);

		session.tick(DEFAULTS.spiralReleaseSeconds + 30);

		expect(session.spiralActive).toBe(false);
		session.stop();
	});
});

describe('sensor arbitration inside a ride', () => {
	/**
	 * The ranking itself is tested in ble/arbitrate.test.ts. What matters here is
	 * that the ride actually goes through it — targets, auto-pause, execution and
	 * the .fit must all read the same agreed numbers rather than the raw trainer.
	 */
	function rideWith(
		readings: () => Record<
			string,
			{ at: number; watts?: number; cadence?: number; heartRate?: number }
		>,
	) {
		const trainer = new SimulatedTrainer();
		return createRideSession({ trainer, workout, ftp: 200, readings });
	}

	it('shows the power meter rather than the trainer', async () => {
		const session = rideWith(() => ({
			'power-meter': { watts: 213, at: 0 },
		}));
		await session.start();
		session.onSample({ watts: 200, cadence: 85, at: 0 });

		expect(session.sample?.watts).toBe(213);
		session.stop();
	});

	it('records heart rate so it reaches the .fit export', async () => {
		const session = rideWith(() => ({
			'heart-rate': { heartRate: 148, at: 0 },
		}));
		await session.start();
		session.onSample({ watts: 200, cadence: 85, at: 0 });

		expect(session.recording.at(-1)?.heartRate).toBe(148);
		session.stop();
	});

	it('records zero heart rate when nothing reports it, which the encoder omits', async () => {
		const session = ride();
		await session.start();
		session.onSample({ watts: 200, cadence: 85, at: 0 });

		expect(session.recording.at(-1)?.heartRate).toBe(0);
		session.stop();
	});

	it('auto-pauses on the cadence sensor, not the trainer estimate', async () => {
		// Kickr cadence is firmware-estimated and drops out on sprint-to-easy
		// transitions (RESEARCH.md §11); a real sensor saying 0 is the truth.
		const session = rideWith(() => ({ cadence: { cadence: 0, at: 0 } }));
		await session.start();
		for (let i = 0; i < DEFAULTS.pauseAfterSeconds; i++) {
			session.onSample({ watts: 0, cadence: 80, at: i * 1000 });
			session.tick();
		}

		expect(session.state).toBe('autopaused');
		session.stop();
	});
});

describe('soloRide', () => {
	it('is active from start until the ride ends, by stop or by the clock', async () => {
		const stopped = ride();
		await stopped.start();
		expect(soloRide.active).toBe(true);
		stopped.stop();
		expect(soloRide.active).toBe(false);

		const finished = ride();
		await finished.start();
		expect(soloRide.active).toBe(true);
		pedal(finished, 200, 90, 120);
		expect(finished.state).toBe('done');
		expect(soloRide.active).toBe(false);
	});
});
