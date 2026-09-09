import { describe, expect, it, vi } from 'vitest';

const hud = vi.hoisted(() => ({
	published: [] as Array<{ watts: number; fault?: string }>,
}));
vi.mock('$lib/hud/feed', () => ({
	publishHud: (s: { watts: number; fault?: string }) => {
		hud.published.push(s);
	},
}));
import { SimulatedTrainer } from '$lib/ble/simulated';
import {
	createRideSession,
	DEFAULTS,
	soloRide,
	toleranceBand,
	SIGNAL_LOST_MS,
	SPRINT_LEAD_SECONDS,
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

describe('createRideSession startedAt', () => {
	it('takes the stamp the buffer was opened with, so a retry finds the same ride', () => {
		const trainer = new SimulatedTrainer();
		const session = createRideSession({
			trainer,
			workout,
			ftp: 200,
			startedAt: 5_000,
		});
		expect(session.startedAt.getTime()).toBe(5_000);
	});
});

/** A sprint first, so the window is live the moment the ride starts. */
const sprintWorkout: Workout = {
	name: 'sprint then steady',
	steps: [
		{ type: 'sprint', seconds: 15 },
		{ type: 'steady', seconds: 60, target: 0.6 },
	],
};

describe('the sprint window (#1793)', () => {
	it('is on from the first tick of a sprint block and gone after it', async () => {
		const session = createRideSession({
			trainer: new SimulatedTrainer(),
			workout: sprintWorkout,
			ftp: 200,
		});
		await session.start();
		const window = session.sprint;
		expect(window).not.toBeNull();
		expect(window!.endsAtMs - window!.startsAtMs).toBe(15_000);
		// The same object all window long: "left" runs down on one anchor.
		session.tick(5);
		expect(session.sprint).toBe(window);
		pedal(session, 300, 100, 11);
		expect(session.sprint).toBeNull();
		session.stop();
	});

	it('counts the next sprint in before it starts', async () => {
		const session = createRideSession({
			trainer: new SimulatedTrainer(),
			workout: {
				name: 'steady then sprint',
				steps: [
					{ type: 'steady', seconds: 60, target: 0.6 },
					{ type: 'sprint', seconds: 15 },
				],
			},
			ftp: 200,
		});
		await session.start();
		expect(session.sprint).toBeNull();
		session.tick(60 - SPRINT_LEAD_SECONDS - 1);
		expect(session.sprint).toBeNull();
		session.tick();
		const window = session.sprint;
		expect(window).not.toBeNull();
		expect(window!.startsAtMs).toBeGreaterThan(Date.now() + 1_000);
		session.stop();
		expect(session.sprint).toBeNull();
	});
});

describe('a sprint block', () => {
	function sprintRide(singleSpeed = false) {
		const trainer = new SimulatedTrainer();
		const slope = vi.spyOn(trainer, 'setSimulation');
		const erg = vi.spyOn(trainer, 'setTargetPower');
		const session = createRideSession({
			trainer,
			workout: sprintWorkout,
			ftp: 200,
			sprint: () => ({ grade: 6, singleSpeed }),
		});
		return { session, slope, erg };
	}

	it('releases the trainer to slope instead of commanding ERG 0 W (#1529)', async () => {
		const { session, slope, erg } = sprintRide();
		await session.start();
		pedal(session, 700, 110, 3);
		expect(slope).toHaveBeenCalledWith(0);
		// The bug: `info.targetWatts ?? 0` made a sprint indistinguishable from
		// a guard's zero, and zero in ERG is a freewheel.
		expect(erg).not.toHaveBeenCalledWith(0);
	});

	it('holds ftp × 2 on a single-speed setup, where slope has no range', async () => {
		const { session, slope, erg } = sprintRide(true);
		await session.start();
		pedal(session, 700, 110, 3);
		expect(erg).toHaveBeenCalledWith(400);
		expect(slope).not.toHaveBeenCalled();
	});

	it('goes back to the workout target when the window closes', async () => {
		const { session, erg } = sprintRide();
		await session.start();
		pedal(session, 700, 110, 20);
		expect(erg).toHaveBeenCalledWith(120);
	});
});

describe('the recording', () => {
	// The live meter bands the BIASED target; the server re-scores the saved
	// ride and bands whatever bias each sample carries. A recording that keeps
	// no trim is scored against the workout as written, and the rider is handed
	// an execution they never saw (#1530).
	it('keeps the trim each second was ridden at', async () => {
		const session = ride();
		await session.start();
		for (let i = 0; i < 4; i++) {
			if (i === 2) session.nudgeBias(-DEFAULTS.biasStep);
			session.onSample({ watts: 200, cadence: 90, at: i * 1000 });
			session.tick();
		}
		const biases = session.recording.map((sample) => sample.bias);
		expect(biases).toHaveLength(4);
		expect(biases[0]).toBe(1);
		expect(biases.at(-1)).toBeCloseTo(1 - DEFAULTS.biasStep, 5);
	});
});

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
		// And the record says which seconds the guard took (#1796), so the
		// saved ride leaves them out the way this meter did.
		// pedal() restarts its clock, so of the ten stopped samples only the
		// last five are new seconds; the pause engages on the third of them
		// and that second is already the guard's.
		const released = session.recording.map((sample) => sample.released);
		expect(released).toEqual([
			false,
			false,
			false,
			false,
			false,
			false,
			false,
			true,
			true,
			true,
		]);
		session.stop();
	});

	it('stamps each recorded sample with the workout second, which stops while auto-paused', async () => {
		// #1733: the record counts wall seconds; the score is keyed on the
		// workout clock, so a stop mid-block must not shift what follows.
		const session = ride();
		await session.start();
		for (let at = 0; at < 15; at++) {
			const riding = at < 5;
			session.onSample({
				watts: riding ? 200 : 0,
				cadence: riding ? 90 : 0,
				at: at * 1000,
			});
			session.tick();
		}
		expect(session.state).toBe('autopaused');
		const seconds = session.recording.map((sample) => sample.second);
		const clocks = session.recording.map((sample) => sample.clock);
		expect(seconds).toEqual([...Array(15).keys()]);
		expect(clocks.slice(0, 5)).toEqual([0, 1, 2, 3, 4]);
		// The wall clock reached 14; the workout clock stopped with the rider
		// and held there for every stopped second after the pause engaged.
		expect(clocks.at(-1)).toBeLessThan(seconds.at(-1)!);
		expect(new Set(clocks.slice(-5)).size).toBe(1);
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

	// #1795: the natural end used to set `done` and nothing else — the GATT
	// link, the wake lock and the recorder all outlived the ride under the
	// summary, and an Export pressed later was longer than the saved ride.
	it('lets go of the trainer and the recorder when the clock runs out', async () => {
		const trainer = new SimulatedTrainer();
		const session = createRideSession({ trainer, workout, ftp: 200 });
		await session.start();
		expect(trainer.status).toBe('connected');
		pedal(session, 200, 90, 120);
		expect(session.state).toBe('done');
		expect(trainer.status).toBe('disconnected');
		const recorded = session.recording.length;
		session.onSample({ watts: 200, cadence: 90, at: 500_000 });
		expect(session.recording.length).toBe(recorded);
	});

	// #1798, at the session: two notifications a second reach auto-pause
	// after SPEC's seconds, not half of them.
	it('auto-pauses after SPEC seconds on a trainer notifying twice a second', async () => {
		const session = ride();
		await session.start();
		for (let s = 0; s < DEFAULTS.pauseAfterSeconds; s++) {
			session.onSample({ watts: 0, cadence: 0, at: s * 1000 });
			if (s < DEFAULTS.pauseAfterSeconds - 1)
				expect(session.state).toBe('running');
			session.onSample({ watts: 0, cadence: 0, at: s * 1000 + 500 });
			session.tick();
		}
		expect(session.state).toBe('autopaused');
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

describe('the execution score (#795)', () => {
	// SPEC: "% of riding seconds inside the band, weighted by step intensity
	// (each second weighs target/FTP) ... Warmup/cooldown/freeride excluded."
	// The server has always scored it that way; this side counted samples
	// equally and included the warmup, so one ride produced two numbers.
	const workout: Workout = {
		name: 'weighted',
		steps: [
			{ type: 'warmup', seconds: 10, from: 0.4, to: 0.4 },
			{ type: 'steady', seconds: 10, target: 1.0 }, // 200 W, weight 1.0
			{ type: 'steady', seconds: 10, target: 0.5 }, //100 W, weight 0.5
		],
	};

	function scored(watts: (second: number) => number, bias = 1) {
		const trainer = new SimulatedTrainer();
		const session = createRideSession({ trainer, workout, ftp: 200 });
		return { session, trainer, watts, bias };
	}

	async function ride(
		setup: ReturnType<typeof scored>,
		seconds = 30,
	): Promise<number> {
		await setup.session.start();
		for (let i = 0; i < Math.round((setup.bias - 1) / DEFAULTS.biasStep); i++)
			setup.session.nudgeBias(DEFAULTS.biasStep);
		for (let i = 0; i > Math.round((setup.bias - 1) / DEFAULTS.biasStep); i--)
			setup.session.nudgeBias(-DEFAULTS.biasStep);
		for (let second = 0; second < seconds; second++) {
			setup.session.onSample({
				watts: setup.watts(second),
				cadence: 90,
				at: second * 1000,
			});
			setup.session.tick();
		}
		const value = setup.session.execution;
		setup.session.stop();
		return value;
	}

	it('ignores the warmup, whatever the rider does in it', async () => {
		// Nothing at all in the warmup, then both blocks exactly on target.
		const on = (second: number) => (second < 10 ? 30 : second < 20 ? 200 : 100);
		expect(await ride(scored(on))).toBeCloseTo(1, 5);
	});

	it('weighs a hard block more than an easy one', async () => {
		// Nail the hard block (weight 1.0), miss the easy one (weight 0.5):
		// 1.0 / 1.5 = 2/3, not the unweighted 1/2.
		const half = (second: number) =>
			second < 10 ? 80 : second < 20 ? 200 : 300;
		expect(await ride(scored(half))).toBeCloseTo(2 / 3, 5);
	});

	it("scores against the rider's own biased target", async () => {
		// At −20 % the blocks want 160 W and 80 W. Riding those is a perfect
		// ride; riding the prescribed 200/100 is not.
		const own = (second: number) => (second < 10 ? 80 : second < 20 ? 160 : 80);
		expect(await ride(scored(own, 0.8))).toBeCloseTo(1, 5);
		const prescribed = (second: number) =>
			second < 10 ? 80 : second < 20 ? 200 : 100;
		expect(await ride(scored(prescribed, 0.8))).toBeCloseTo(0, 5);
	});
});

// A trainer notifying four times inside one second is one second of riding
// (audit 2026-09-09): the record is read as one entry per second by the
// summary, the .fit and the server's XP.
describe('the ride record', () => {
	it('admits one sample per ride second however often the trainer notifies', async () => {
		const session = ride();
		await session.start();
		for (let i = 0; i < 4; i++)
			session.onSample({ watts: 200, cadence: 90, at: i * 250 });
		expect(session.recording.length).toBe(1);
		session.tick();
		session.onSample({ watts: 210, cadence: 90, at: 1000 });
		expect(session.recording.length).toBe(2);
		session.stop();
	});
});

// The HUD feed comes from the session, not the screen (#1665): it follows
// the ride off /ride, and it says when the trainer has gone quiet instead
// of showing a confident 0.
describe('the HUD feed (#1665)', () => {
	it('publishes each tick, with the fault the screen would show', async () => {
		vi.useFakeTimers();
		let t = 0;
		const trainer = new SimulatedTrainer();
		const session = createRideSession({
			trainer,
			workout,
			ftp: 200,
			now: () => t,
		});
		await session.start();
		hud.published.length = 0;
		session.onSample({ watts: 150, cadence: 90, at: 0 });
		session.tick();
		expect(hud.published.at(-1)).toMatchObject({ watts: 150 });
		expect(hud.published.at(-1)?.fault).toBeUndefined();

		t = SIGNAL_LOST_MS + 1000;
		session.tick();
		expect(hud.published.at(-1)).toMatchObject({
			watts: 150,
			fault: 'trainer',
		});
		vi.useRealTimers();
	});
});
