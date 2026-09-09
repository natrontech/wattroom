import { describe, expect, it } from 'vitest';
import { peaksOf } from '$lib/sound/peaks';

describe('peaksOf', () => {
	it('takes the loudest sample per bucket and normalises to the loudest bucket', () => {
		expect(peaksOf(new Float32Array([0, 0.5, -1, 0.25]), 2)).toEqual([0.5, 1]);
	});

	it('leaves silence flat rather than dividing by zero', () => {
		expect(peaksOf(new Float32Array([0, 0, 0, 0]), 2)).toEqual([0, 0]);
	});

	it('draws as many bars as asked, even past the samples', () => {
		expect(peaksOf(new Float32Array([1, 1]), 4)).toHaveLength(4);
	});

	// A mastered track: every bucket clips at full scale, only the energy
	// between the spikes differs. Peak draws a wall; rms draws the song.
	const limited = new Float32Array(1200);
	for (let i = 0; i < limited.length; i++) {
		const loud = i >= 400 && i < 800;
		limited[i] = i % 100 === 0 ? 1 : loud ? 0.9 : 0.05;
	}

	it('flattens a mastered track to a wall when it takes peaks', () => {
		expect(peaksOf(limited, 3)).toEqual([1, 1, 1]);
	});

	it('draws the quiet and loud thirds apart when it takes rms', () => {
		const [intro, drop, outro] = peaksOf(limited, 3, 'rms');
		expect(drop).toBeCloseTo(1);
		expect(intro).toBeLessThan(0.4);
		expect(outro).toBeCloseTo(intro);
	});
});
