import { describe, expect, it, vi } from 'vitest';

// A real envelope, not null (#2366). Mocked to null, `decoded` stayed empty
// for the whole file and shapeOf could only ever take the fallback branch —
// so the test named "either way" checked one way, and scaling the decoded
// bars nine times out of their box passed the whole suite.
vi.mock('$lib/sound/board.svelte', () => ({
	peaks: vi.fn(async (_clipId: string, bars: number) =>
		Array.from({ length: bars }, (_, i) => i / (bars - 1)),
	),
}));

const { shapeOf, learn } = await import('$lib/board/shapes.svelte');
const { waveform } = await import('$lib/board/waveform');

const BOX_H = 34;
const BOX_W = 104;

/** The box every pad draws in, whichever shape it has. */
function fillsTheBox(bars: ReturnType<typeof waveform>) {
	for (const bar of bars) {
		expect(bar.y).toBeGreaterThanOrEqual(0);
		expect(bar.y + bar.h).toBeLessThanOrEqual(BOX_H);
		expect(bar.x).toBeLessThan(BOX_W);
	}
}

describe('shapeOf', () => {
	// `asked` is module-level, so each test needs a clip of its own.
	it('falls back to the id-derived shape while the audio is undecoded', () => {
		expect(shapeOf('undecoded-clip', 20)).toEqual(
			waveform('undecoded-clip', 20),
		);
	});

	it('fills the same box either way, so a pad never resizes under the rider', async () => {
		const clip = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';
		fillsTheBox(shapeOf(clip, 20));

		learn(clip, 20);
		await vi.waitFor(() =>
			expect(shapeOf(clip, 20)).not.toEqual(waveform(clip, 20)),
		);
		fillsTheBox(shapeOf(clip, 20));
	});
});
