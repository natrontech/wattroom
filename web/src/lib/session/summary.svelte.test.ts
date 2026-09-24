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
async function setup(
	startedAt: () => number | undefined,
	// Its own close unless a test shares one: dismissals outlive a mount.
	sessionId: string = crypto.randomUUID(),
) {
	let phase = $state<string | undefined>('idle');
	let workout = $state('Openers');
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
			sessionId: () => sessionId,
			workoutName: () => workout,
			riders: () => [],
			ftp: () => 250,
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
		async pick(name: string) {
			workout = name;
			phase = 'idle';
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
	const workout = 'Openers';
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
			sessionId: () => 's1',
			workoutName: () => workout,
			riders: () => [],
			ftp: () => 250,
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

// The coach dismissing theirs and picking the next workout turned the phase
// back to idle within a second, and every other rider's summary went with it
// (#2603). The card is the close's, and stays until its rider is done.
describe('the summary card outlives the next pick (#2603)', () => {
	it('keeps the close through a pick, and lets go when the next one runs', async () => {
		const t = await setup(() => undefined);
		await t.go('running');
		ride(t.recording, SUMMARY_MIN_SAMPLES);
		await t.go('done');
		expect(t.summary.card?.workoutName).toBe('Openers');
		expect(t.summary.card?.samples).toHaveLength(SUMMARY_MIN_SAMPLES);

		await t.pick('Threshold');
		expect(t.summary.card?.workoutName, 'the next pick closed it').toBe(
			'Openers',
		);
		// The recording clears itself on the edge into the next session.
		t.recording.follow('countdown');
		await t.go('countdown');
		expect(t.summary.card?.samples, 'the countdown emptied it').toHaveLength(
			SUMMARY_MIN_SAMPLES,
		);

		await t.go('running');
		expect(t.summary.card).toBeNull();
		t.off();
	});

	it('is gone once dismissed, and never shown for under a minute', async () => {
		const t = await setup(() => undefined);
		await t.go('running');
		ride(t.recording, SUMMARY_MIN_SAMPLES - 1);
		await t.go('done');
		expect(t.summary.card).toBeNull();

		await t.go('running');
		ride(t.recording, SUMMARY_MIN_SAMPLES);
		await t.go('done');
		expect(t.summary.card).not.toBeNull();
		t.summary.dismiss();
		expect(t.summary.card).toBeNull();
		t.off();
	});
});

// The session's page hands off to its channel's at the close (#2600), and the
// summary mounts again there. A rider who had already closed theirs saw it
// come back (#2603).
it('a dismissed close stays dismissed on the next mount', async () => {
	const first = await setup(() => undefined, 'shared-close');
	await first.go('running');
	ride(first.recording, SUMMARY_MIN_SAMPLES);
	await first.go('done');
	first.summary.dismiss();
	first.off();

	const again = await setup(() => undefined, 'shared-close');
	await again.go('running');
	ride(again.recording, SUMMARY_MIN_SAMPLES);
	await again.go('done');
	expect(again.summary.card, 'the dismissed summary came back').toBeNull();
	again.off();
});
