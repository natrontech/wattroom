// @vitest-environment happy-dom
import { flushSync, tick } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import { SimulatedTrainer } from '$lib/ble/simulated';
import { COUNTDOWN_SECONDS, createRideSession } from './session.svelte';
import type { Workout } from './types';

vi.mock('$lib/hud/feed', () => ({ publishHud: () => {} }));

/**
 * The solo ride's live execution, as a screen reads it (#2769): from inside an
 * effect, the way RidingScreen's numbers row does. The weights behind it were
 * plain variables, so the row's cell never appeared and the score froze at its
 * first read — which the other tests, reading once at the end and outside any
 * effect, could not see.
 */
describe('the live execution score', () => {
	it('reaches the screen while the ride is scored', async () => {
		const workout: Workout = {
			name: 'live',
			steps: [
				{ type: 'warmup', seconds: 5, from: 0.4, to: 0.4 },
				{ type: 'steady', seconds: 20, target: 1.0 },
			],
		};
		const session = createRideSession({
			trainer: new SimulatedTrainer(),
			workout,
			ftp: 200,
		});
		let shown: number | undefined;
		const stop = $effect.root(() => {
			$effect(() => {
				shown = session.scored ? session.execution : undefined;
			});
		});
		flushSync();
		await session.start();
		session.tick(COUNTDOWN_SECONDS);
		await tick();
		expect(shown).toBeUndefined();

		// The warm-up scores nothing; the steady block at half its target
		// scores every second as a miss.
		for (let second = 0; second < 15; second++) {
			session.onSample({ watts: 100, cadence: 90, at: second * 1000 });
			session.tick();
			await tick();
		}
		expect(shown).toBe(0);

		stop();
		session.stop();
	});
});
