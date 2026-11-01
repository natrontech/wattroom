import { describe, expect, it } from 'vitest';
import { MaxBridgedGap } from '$lib/protocol';
import { createRecording } from './recording.svelte';

// The record is read as one entry per second downstream (#1411): a trainer
// that notifies twice a second must not ride twice as far.
describe('createRecording', () => {
	it('admits one sample per timeline second', () => {
		const recording = createRecording({ ftp: () => 200 });
		for (let i = 0; i < 10; i++) recording.record(5, 200 + i);
		expect(recording.samples.length).toBe(1);
		recording.record(6, 210);
		expect(recording.samples.length).toBe(2);
		recording.record(6.9, 220);
		expect(recording.samples.length).toBe(2);
		recording.follow('running');
		recording.record(0, 100);
		expect(recording.samples.length).toBe(1);
	});

	// A trainer reading that lands a second late must not shorten the ride
	// (#4316): a short silence is a line between its two readings, a long one
	// stays a gap.
	it('draws a short silence between its two readings', () => {
		const recording = createRecording({ ftp: () => 200 });
		recording.record(0, 150);
		recording.record(2, 200);
		expect(recording.samples).toEqual([
			{ watts: 150 },
			{ watts: 175 },
			{ watts: 200 },
		]);
		expect(recording.trace.map((point) => point.t)).toEqual([0, 1, 2]);
		recording.record(2 + MaxBridgedGap + 2, 220);
		expect(recording.samples.length).toBe(4);
	});

	// The HUD reads the live numbers off the same admitted seconds the summary
	// reads (#3068): a double-notifying trainer must not count twice there
	// either, and a new session starts them over with the samples.
	it('feeds the live numbers the seconds it admits', () => {
		const recording = createRecording({ ftp: () => 200 });
		recording.record(0, 100);
		recording.record(0.5, 900);
		recording.record(1, 200, { block: 1, target: 200 });
		expect(recording.live.seconds).toBe(2);
		expect(recording.live.power3).toBe(150);
		expect(recording.live.blockExecution).toBe(1);
		recording.follow('running');
		expect(recording.live.seconds).toBe(0);
	});

	// The trace is keyed on the workout clock and drawn across the whole ride,
	// so dropping its oldest entries erased the start of the line rather than
	// scrolling it: past 15 minutes the graph, the TV mode and the summary all
	// began at t = elapsed − 899 (#2017).
	it('keeps the whole ride, not the last quarter-hour', () => {
		const recording = createRecording({ ftp: () => 200 });
		// An hour, well past the 898 the trace used to keep.
		for (let t = 0; t < 3600; t++) recording.record(t, 150 + (t % 50));
		expect(recording.trace.length).toBe(3600);
		expect(recording.trace[0]).toEqual({ t: 0, w: 150 });
		expect(recording.trace.at(-1)).toEqual({ t: 3599, w: 150 + (3599 % 50) });
	});
});

function ride(recording: ReturnType<typeof createRecording>, seconds: number) {
	for (let s = 0; s < seconds; s++) recording.record(s, 200);
}

describe('the recording belongs to one session (#1535)', () => {
	it('clears on the edge into a session, on every client', () => {
		const recording = createRecording({ ftp: () => 200 });
		recording.follow('idle');
		recording.follow('countdown');
		recording.follow('running');
		ride(recording, 90);
		recording.follow('done');
		// The summary of the first session keeps its samples while it shows.
		expect(recording.samples).toHaveLength(90);
		// The coach starts the main set: nobody pressed Start on this client.
		recording.follow('countdown');
		expect(recording.samples).toEqual([]);
		recording.follow('running');
		ride(recording, 30);
		expect(recording.samples).toHaveLength(30);
	});

	it('clears when a session starts without a countdown seen', () => {
		const recording = createRecording({ ftp: () => 200 });
		ride(recording, 10);
		recording.follow('running');
		expect(recording.samples).toEqual([]);
		// Pausing and resuming is the same session: nothing clears.
		ride(recording, 5);
		recording.follow('paused');
		recording.follow('running');
		expect(recording.samples).toHaveLength(5);
	});
});
