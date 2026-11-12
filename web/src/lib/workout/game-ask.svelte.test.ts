import { describe, expect, it, vi } from 'vitest';

vi.mock('#lib/hud/feed.ts', () => ({ publishHud: () => {} }));

import { SimulatedTrainer } from '#lib/ble/simulated.ts';
import { gameWorkout } from '#lib/ride/solo-game.svelte.ts';
import { createRideSession } from './session.svelte';
import { COUNTDOWN_SECONDS } from './ride-state';

// A game alone (#4539) rides a free ride with no road under the game: Backyard
// Ramp's line is held in ERG, and with nothing asked the rider's own drive is.
describe('a game alone’s ask on the ride', () => {
	it('holds the game’s watts once the count-in ends, and lets go when it asks none', async () => {
		let ask = 0;
		const session = createRideSession({
			trainer: new SimulatedTrainer(),
			workout: gameWorkout('backyard-ramp'),
			ftp: 250,
			ask: () => ask,
		});
		await session.start();
		ask = 200;
		expect(session.target, 'a target during the count-in').toBe(0);
		session.tick(COUNTDOWN_SECONDS);
		expect(session.target).toBe(200);
		ask = 213;
		session.tick(1);
		expect(session.target).toBe(213);
		ask = 0;
		session.tick(1);
		expect(session.target, 'a game that asks nothing kept a target').toBe(0);
		session.stop();
	});
});
