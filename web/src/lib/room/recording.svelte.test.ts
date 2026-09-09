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
});
