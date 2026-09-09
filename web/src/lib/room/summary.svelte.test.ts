// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { tick } from 'svelte';

const served = vi.hoisted(() => ({
	rides: [] as { id: string; startedAt: string; room: boolean; xp?: number }[],
}));
vi.mock('$lib/api', () => ({
	api: async (path: string) =>
		path === '/api/rides'
			? { ok: true, data: { rides: served.rides } }
			: { ok: true, data: { medals: [] } },
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
			slug: () => 'crew',
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

describe('the recording belongs to one session (#1535)', () => {
	it('clears on the edge into a session, on every client', async () => {
		const t = await setup(() => undefined);
		await t.go('countdown');
		await t.go('running');
		ride(t.recording, 90);
		await t.go('done');
		// The summary of the first session keeps its samples while it shows.
		expect(t.recording.samples).toHaveLength(90);
		// The coach starts the main set: nobody pressed Start on this client.
		await t.go('countdown');
		expect(t.recording.samples).toEqual([]);
		await t.go('running');
		ride(t.recording, 30);
		expect(t.recording.samples).toHaveLength(30);
		t.off();
	});

	it('clears when a session starts without a countdown seen', async () => {
		const t = await setup(() => undefined);
		ride(t.recording, 10);
		await t.go('running');
		expect(t.recording.samples).toEqual([]);
		// Pausing and resuming is the same session: nothing clears.
		ride(t.recording, 5);
		await t.go('paused');
		await t.go('running');
		expect(t.recording.samples).toHaveLength(5);
		t.off();
	});
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
