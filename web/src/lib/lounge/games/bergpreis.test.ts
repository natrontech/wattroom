import { describe, expect, it } from 'vitest';
import {
	RUN_SEC,
	bandAt,
	newRun,
	over,
	scoreOf,
	step,
} from '#lib/lounge/games/bergpreis.ts';

const play = (held: (r: ReturnType<typeof newRun>) => boolean) => {
	let r = newRun();
	while (!over(r)) r = step(r, 1 / 60, held(r));
	return r;
};

describe('Bergpreis', () => {
	it('ends after its thirty seconds', () => {
		expect(play(() => false).t).toBe(RUN_SEC);
	});

	it('pays for staying in the band', () => {
		const idle = scoreOf(play(() => false));
		const stuck = scoreOf(play(() => true));
		const good = scoreOf(play((r) => r.power < bandAt(r.t)));
		expect(good).toBeGreaterThan(idle * 3);
		expect(good).toBeGreaterThan(stuck * 2);
	});

	it('stays on the machine however well you play', () => {
		const best = scoreOf(play((r) => r.power < bandAt(r.t)));
		expect(best).toBeLessThan(9999);
	});
});
