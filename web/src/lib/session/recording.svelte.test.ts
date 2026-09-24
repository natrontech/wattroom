import { describe, expect, it } from 'vitest';
import { createRecording } from './recording.svelte';

// The record is read as one entry per second downstream (#1411): a trainer
// that notifies twice a second must not ride twice as far.
describe('createRecording', () => {
	it('admits one sample per timeline second', () => {
		const recording = createRecording();
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

	// The trace is keyed on the workout clock and drawn across the whole ride,
	// so dropping its oldest entries erased the start of the line rather than
	// scrolling it: past 15 minutes the graph, the TV mode and the summary all
	// began at t = elapsed − 899 (#2017).
	it('keeps the whole ride, not the last quarter-hour', () => {
		const recording = createRecording();
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
		const recording = createRecording();
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
		const recording = createRecording();
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
