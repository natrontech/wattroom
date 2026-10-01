import { describe, expect, it } from 'vitest';
import {
	CORRIDOR,
	DOCKS,
	JUKEBOX_SEAT,
	RIDER_BOX,
	STAGE,
	TAKE_TURNS,
	meets,
	type Dock,
} from './docks';

describe('the docks around the world (#3031, ADR-0066)', () => {
	for (const [layout, docks] of Object.entries(DOCKS))
		it(`keep the road, the rider and the jukebox seat clear on a ${layout}`, () => {
			for (const [name, box] of Object.entries(docks)) {
				expect(meets(box, CORRIDOR), `${name} in the keep-clear corridor`).toBe(
					false,
				);
				expect(meets(box, RIDER_BOX), `${name} over the rider`).toBe(false);
				expect(meets(box, JUKEBOX_SEAT), `${name} over the jukebox seat`).toBe(
					false,
				);
				expect(
					box.x0 >= 0 && box.y0 >= 0 && box.x1 <= 1 && box.y1 <= 1,
					`${name} on the screen`,
				).toBe(true);
			}
			const names = Object.keys(docks) as Dock[];
			for (const [i, a] of names.entries())
				for (const b of names.slice(i + 1))
					if (!(TAKE_TURNS.includes(a) && TAKE_TURNS.includes(b)))
						expect(meets(docks[a], docks[b]), `${a} over ${b}`).toBe(false);
		});

	it('puts a shared screen between the columns, clear of the jukebox seat', () => {
		expect(meets(STAGE, JUKEBOX_SEAT)).toBe(false);
		for (const docks of Object.values(DOCKS))
			for (const name of [
				'header',
				'status',
				'numbers',
				'crew',
				'horizon',
			] as Dock[])
				expect(meets(STAGE, docks[name]), `the stage over ${name}`).toBe(false);
	});
});
