import { render } from 'svelte/server';
import { describe, expect, it, vi } from 'vitest';
import TvOverlay from '$lib/session/TvOverlay.svelte';

vi.mock('$lib/hud/feed', () => ({ publishHud: () => {} }));

/**
 * A free ride's TV (#3669, TARGETS ride-free-road 7): the frame a workout
 * ride has, handed a roster of one with no block and no segments — the
 * shape RoadRiding builds — draws the clock and the numbers rather than
 * asking for a block it does not have.
 */
describe('the free ride on the TV', () => {
	it('draws with no block, no segments and one rider', () => {
		const { body } = render(TvOverlay, {
			props: {
				riders: [
					{
						id: 'you',
						name: 'You',
						ftp: 250,
						kg: 75,
						you: true,
						coach: false,
						cameraOn: false,
						muted: false,
						speaking: false,
						hue: 0,
						watts: 160,
						cadence: 85,
						hr: 0,
						stale: false,
						target: 0,
						trace: [],
					},
				],
				segments: [],
				total: 0,
				elapsed: 76,
				block: null,
				placeName: 'Free ride · Design switchbacks',
				live: true,
				onExit: () => {},
			},
		});
		expect(body).toContain('1:16');
		expect(body).toContain('160');
	});
});
