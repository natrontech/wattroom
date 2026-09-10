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
		recording.reset();
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
