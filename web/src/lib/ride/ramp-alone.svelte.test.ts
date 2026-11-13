// @vitest-environment happy-dom
import { tick } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import { holdRampAlone } from './ramp-alone.svelte.ts';
import { buildRampTest, ftpFromRamp, RAMP } from '#lib/workout/ramp.ts';
import { flatten, targetAt } from '#lib/workout/engine.ts';

vi.mock('#lib/sound/cues.ts', () => ({ play: vi.fn() }));
vi.mock('#lib/toast.svelte.ts', () => ({ toasts: { push: vi.fn() } }));
vi.mock('#lib/ride/save.ts', () => ({ stampFtpAfter: vi.fn() }));

/** The workout session as the ramp reads it: a clock, a record, Skip and End. */
function fakeSession() {
	const segments = flatten(buildRampTest());
	let seconds = $state(0);
	let recording = $state.raw<{ watts: number; heartRate?: number }[]>([]);
	let state = $state('running');
	const info = () => targetAt(segments, 200, seconds);
	return {
		segments,
		spiralActive: false,
		get elapsed() {
			return seconds;
		},
		get info() {
			return info();
		},
		get recording() {
			return recording;
		},
		get state() {
			return state;
		},
		get sample() {
			return { at: Date.now(), watts: recording.at(-1)?.watts ?? 0 };
		},
		skip() {
			const next = segments[info().segmentIndex + 1];
			if (next) seconds = next.startSeconds;
		},
		stop() {
			state = 'done';
		},
		/** Rides `n` seconds at `watts`, or at the target when absent. */
		async ride(n: number, watts?: number) {
			for (let i = 0; i < n && state !== 'done'; i++) {
				recording = [
					...recording,
					{ watts: watts ?? info().targetWatts ?? 0, heartRate: 150 },
				];
				seconds++;
				await tick();
			}
		},
	};
}

// #4558: every end of the ramp part rolls into a cool-down at the old FTP.
describe('the ramp test rolls into a cool-down', () => {
	const coolStart = RAMP.warmupSeconds + RAMP.steps * RAMP.stepSeconds;

	async function start() {
		const session = fakeSession();
		// It holds its own effect root, as theRide keeps it.
		const ramp = holdRampAlone({
			session: session as never,
			savedId: () => null,
		});
		return { session, ramp, stop: ramp.dispose };
	}

	it('switches to cool-down targets when the rider blows', async () => {
		const { session, ramp, stop } = await start();
		await session.ride(RAMP.warmupSeconds + 4 * RAMP.stepSeconds);
		const ridden = session.recording.length;
		await session.ride(RAMP.failSeconds, 10);
		expect(ramp.done).toBe(true);
		expect(session.state).toBe('running');
		expect(session.elapsed).toBe(coolStart);
		expect(session.info.targetWatts).toBe(100); // 50 % of the old 200 W
		// The FTP is the ramp part's, whatever the cool-down holds.
		const before = ftpFromRamp(ramp.watts).ftp;
		await session.ride(120, 900);
		expect(ramp.watts).toHaveLength(ridden + RAMP.failSeconds);
		expect(ftpFromRamp(ramp.watts).ftp).toBe(before);
		expect(ramp.elapsed).toBe(ridden + RAMP.failSeconds);
		stop();
	});

	it('does the same on I’m done', async () => {
		const { session, ramp, stop } = await start();
		await session.ride(RAMP.warmupSeconds + 2 * RAMP.stepSeconds);
		ramp.stop();
		await tick();
		expect(session.state).toBe('running');
		expect(session.elapsed).toBe(coolStart);
		stop();
	});

	it('and after the last step, then ends with the cool-down', async () => {
		const { session, ramp, stop } = await start();
		await session.ride(coolStart);
		await tick();
		expect(ramp.done).toBe(true);
		expect(ramp.elapsed).toBe(coolStart);
		await session.ride(RAMP.coolSeconds + 5);
		stop();
	});
});
