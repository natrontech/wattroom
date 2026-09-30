import { describe, expect, it, vi } from 'vitest';

const published: { road?: unknown }[] = [];
vi.mock('$lib/hud/feed', () => ({
	publishHud: (snapshot: { road?: unknown }) => void published.push(snapshot),
}));

import { SimulatedTrainer } from '$lib/ble/simulated';
import { packRoad, type Road } from '$lib/road/road';
import { roadLine } from '$lib/ride/road-readout';
import { describeBlock } from './block';
import { COUNTDOWN_SECONDS } from './ride-state';
import { createRideSession } from './session.svelte';
import type { Workout } from './types';

// A hand-written road (#3054): 1 km flat, then 2 km at 5 % — nobody's route.
const road: Road = {
	length: 3000,
	heights: Array.from({ length: 151 }, (_, i) =>
		i <= 50 ? 100 : 100 + (i - 50),
	),
	turns: Array<number>(150).fill(0),
};
const workout: Workout = {
	name: 'Road · 3.0 km',
	steps: [{ type: 'steady', seconds: 1200, target: 0.7 }],
	road: {
		routeId: '00000000-0000-0000-0000-000000000001',
		fromM: 0,
		toM: 3000,
		profile: btoa(String.fromCharCode(...packRoad(road))),
		originM: 0,
	},
};

describe('slot 1 and the HUD say one road readout (#3639)', () => {
	it('sends the HUD, every second, the readout slot 1 draws', async () => {
		const session = createRideSession({
			trainer: new SimulatedTrainer(),
			workout,
			ftp: 250,
			kg: () => 75,
		});
		await session.start();
		session.tick(COUNTDOWN_SECONDS);
		for (let s = 0; s < 240; s++) {
			published.length = 0;
			session.onSample({ watts: 250, cadence: 85, at: s * 1000 });
			const readout = session.road!.readout;
			const block = describeBlock(
				session.info,
				session.segments,
				workout,
				250,
				[],
				readout,
			);
			expect(published.at(-1)?.road, `second ${s}`).toEqual(block.road);
		}
		const last = session.road!.readout;
		expect(last.km).toBeGreaterThan(1);
		expect(roadLine(last)).toMatch(
			/^km \d+\.\d of 3\.0 · 5\.0 % · top in \d\.\d km$/,
		);
	});
});
