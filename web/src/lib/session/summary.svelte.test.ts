// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { tick } from 'svelte';

const served = vi.hoisted(() => ({
	rides: [] as {
		id: string;
		startedAt: string;
		room?: boolean;
		channel?: { id: string };
		xp?: number;
	}[],
	medals: {} as Record<string, { kind: string }[]>,
}));
vi.mock('$lib/api', () => ({
	api: async (path: string) =>
		path === '/api/rides'
			? { ok: true, data: { rides: served.rides } }
			: {
					ok: true,
					data: {
						medals: served.medals[path.replace('/api/rides/', '')] ?? [],
					},
				},
}));

const { createSummary, SUMMARY_MIN_SAMPLES } = await import('./summary.svelte');
const { createRecording } = await import('./recording.svelte');

/** A summary wired to a phase the test moves by hand. Effects flush on tick(). */
async function setup(startedAt: () => number | undefined) {
	let phase = $state<string | undefined>('idle');
	const recording = createRecording();
	let summary!: ReturnType<typeof createSummary>;
	const off = $effect.root(() => {
		summary = createSummary({
			recording,
			phase: () => phase,
			startedAt,
			myName: () => 'Jan',
			myId: () => 'u1',
			myExecution: () => 0.9,
		});
	});
	await tick();
	return {
		recording,
		summary,
		async go(next: string) {
			phase = next;
			await tick();
		},
		off,
	};
}

function ride(recording: ReturnType<typeof createRecording>, seconds: number) {
	for (let s = 0; s < seconds; s++) recording.record(s, 200);
}

// The recording lives on the connection and outlives every page; the summary
// is mounted by the channel's shell, once per visit. Coming back to the ride
// mid-session used to read as the edge into a session and wiped the graph's
// power line and the summary's samples with it (#2654).
it('a summary mounted mid-ride leaves the recording alone', async () => {
	const recording = createRecording();
	recording.follow('running');
	ride(recording, 90);
	const off = $effect.root(() => {
		createSummary({
			recording,
			phase: () => 'running',
			startedAt: () => undefined,
			myName: () => 'Jan',
			myId: () => 'u1',
			myExecution: () => 0.9,
		});
	});
	await tick();
	expect(recording.trace).toHaveLength(90);
	expect(recording.samples).toHaveLength(90);
	off();
});

describe('the late joiner finds their ride (#1537)', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		served.rides = [];
	});

	it('matches the ride by the timeline start the tick implies, not by the local clock', async () => {
		const timelineStart = 1_000_000;
		// Joined ten minutes in: the local clock is far past the start.
		vi.setSystemTime(timelineStart + 600_000);
		served.rides = [
			{
				id: 'r1',
				startedAt: new Date(timelineStart).toISOString(),
				room: true,
				xp: 42,
			},
		];
		const t = await setup(() => timelineStart);
		await t.go('running');
		ride(t.recording, SUMMARY_MIN_SAMPLES);
		await t.go('done');
		await vi.advanceTimersByTimeAsync(3_000);
		expect(t.summary.rideId).toBe('r1');
		t.off();
		vi.useRealTimers();
	});
});

// A voice channel's session saves a crew ride — `room` unset, the channel
// named (#2443) — and its medal hangs off that ride (#2522): the summary used
// to look for a room ride and a room's medals, and found neither.
describe('the summary finds a crew ride and its medal (#2522)', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		served.rides = [];
		served.medals = {};
	});

	it('links the ride and shows the medal the session awarded on it', async () => {
		const timelineStart = 2_000_000;
		vi.setSystemTime(timelineStart + 60_000);
		served.rides = [
			{
				id: 'r2',
				startedAt: new Date(timelineStart).toISOString(),
				channel: { id: 'lounge' },
				xp: 55,
			},
		];
		served.medals = { r2: [{ kind: 'metronome' }] };
		const t = await setup(() => timelineStart);
		await t.go('running');
		ride(t.recording, SUMMARY_MIN_SAMPLES);
		await t.go('done');
		await vi.advanceTimersByTimeAsync(3_000);
		expect(t.summary.rideId).toBe('r2');
		expect(t.summary.medal).toMatchObject({ value: '90', unit: '%', xp: 55 });
		t.off();
		vi.useRealTimers();
	});

	it('shows no medal for a ride that won none', async () => {
		const timelineStart = 3_000_000;
		vi.setSystemTime(timelineStart + 60_000);
		served.rides = [
			{
				id: 'r3',
				startedAt: new Date(timelineStart).toISOString(),
				channel: { id: 'lounge' },
			},
		];
		const t = await setup(() => timelineStart);
		await t.go('running');
		ride(t.recording, SUMMARY_MIN_SAMPLES);
		await t.go('done');
		await vi.advanceTimersByTimeAsync(3_000);
		expect(t.summary.rideId).toBe('r3');
		expect(t.summary.medal).toBeUndefined();
		t.off();
		vi.useRealTimers();
	});
});
