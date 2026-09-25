import { describe, expect, it } from 'vitest';
import { MaxBackfillBatch } from '$lib/protocol';
import type { BufferedSample } from '$lib/ride/buffer';
import { replayFrames, timelineOrigin, timelineSecond } from './replay';

const row = (
	seq: number,
	extra: Partial<BufferedSample> = {},
): BufferedSample => ({
	seq,
	watts: 200,
	cadence: 90,
	heartRate: 140,
	at: seq * 1000,
	...extra,
});

describe('a reconnect replay (#2814, #2839)', () => {
	it('sends each row with the second, trim and guard it was ridden with', () => {
		const [frame] = replayFrames([
			row(7, { clock: 612, bias: 0.9, released: true }),
			row(8, { clock: 613, bias: 0.9, released: false }),
		]);
		expect(frame).toEqual([
			{
				watts: 200,
				cadence: 90,
				hr: 140,
				seq: 7,
				bias: 0.9,
				clock: 612,
				released: true,
			},
			{
				watts: 200,
				cadence: 90,
				hr: 140,
				seq: 8,
				bias: 0.9,
				clock: 613,
				released: undefined,
			},
		]);
	});

	it('splits an outage longer than one frame instead of losing its newest part', () => {
		const rows = Array.from({ length: MaxBackfillBatch * 2 + 5 }, (_, i) =>
			row(i + 1),
		);
		const frames = replayFrames(rows);
		expect(frames.map((f) => f.length)).toEqual([
			MaxBackfillBatch,
			MaxBackfillBatch,
			5,
		]);
		expect(frames[2].at(-1)?.seq).toBe(rows.length);
	});

	it('reads the timeline second off the last running tick', () => {
		const origin = timelineOrigin({
			at: 1_000_000,
			state: { phase: 'running', elapsed: 600 } as never,
		});
		expect(origin).toBe(400_000);
		// Through a drop no tick arrives: the count carries on from it.
		expect(timelineSecond(origin, 1_000_000 + 30_400)).toBe(630);
	});

	it('stamps no second while the timeline is not running', () => {
		for (const phase of ['paused', 'idle', 'countdown', 'done'])
			expect(
				timelineSecond(
					timelineOrigin({ at: 1, state: { phase } as never }),
					5000,
				),
			).toBeUndefined();
	});
});
