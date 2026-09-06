import { describe, expect, it } from 'vitest';
import { waveform } from '$lib/board/waveform';

describe('waveform', () => {
	it('is stable for a clip, so a pad never changes shape under the rider', () => {
		expect(waveform('abc', 20)).toEqual(waveform('abc', 20));
	});

	it('differs between clips, which is the whole point of drawing one', () => {
		expect(waveform('abc', 20)).not.toEqual(waveform('abd', 20));
	});

	it('stays inside the box it is drawn in', () => {
		for (const bar of waveform('3f2504e0-4f89-11d3-9a0c-0305e82c3301', 20)) {
			expect(bar.h).toBeGreaterThanOrEqual(2);
			expect(bar.y).toBeGreaterThanOrEqual(0);
			expect(bar.y + bar.h).toBeLessThanOrEqual(34);
			expect(bar.x).toBeLessThan(104);
		}
	});

	it('draws as many bars as asked', () => {
		expect(waveform('abc', 12)).toHaveLength(12);
	});
});
