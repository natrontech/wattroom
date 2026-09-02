import { describe, expect, it } from 'vitest';
import { SNAP, snapSpan } from '$lib/pane-snap';

// A 1000×800 viewport with a 320px side panel, as the room lays it out.
const guides = { x: [0, 500, 680, 1000], y: [0, 400, 800] };
describe('soft guides (#316)', () => {
	it('clicks a pane to the gutter it is nearly touching', () => {
		// Right edge at 680 - 4: within reach of the side panel's gutter.
		expect(snapSpan(296, 380, guides.x)).toBe(300);
	});

	it('makes centred a place you can drop something', () => {
		// Middle at 500 - 3, so the pane lands centred on the viewport.
		expect(snapSpan(307, 380, guides.x)).toBe(310);
	});

	it('lets go the moment you keep pulling', () => {
		const past = 300 - SNAP - 1;
		expect(snapSpan(past, 380, guides.x)).toBe(past);
	});
});
