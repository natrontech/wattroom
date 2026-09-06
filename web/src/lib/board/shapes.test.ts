import { describe, expect, it, vi } from 'vitest';

vi.mock('$lib/sound/board.svelte', () => ({ peaks: vi.fn(async () => null) }));

const { shapeOf } = await import('$lib/board/shapes.svelte');
const { waveform } = await import('$lib/board/waveform');

describe('shapeOf', () => {
	it('falls back to the id-derived shape while the audio is undecoded', () => {
		expect(shapeOf('abc', 20)).toEqual(waveform('abc', 20));
	});

	it('fills the same box either way, so a pad never resizes under the rider', () => {
		for (const bar of shapeOf('3f2504e0-4f89-11d3-9a0c-0305e82c3301', 20)) {
			expect(bar.y).toBeGreaterThanOrEqual(0);
			expect(bar.y + bar.h).toBeLessThanOrEqual(34);
			expect(bar.x).toBeLessThan(104);
		}
	});
});
