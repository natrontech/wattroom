import { describe, expect, it } from 'vitest';
import {
	CORRIDOR,
	GAP_PX,
	INSET_PX,
	JUKEBOX_SEAT,
	MOMENT_MIN_PX,
	RIDER_BOX,
	SIDE_MAX,
	STAGE,
	meets,
	momentAt,
} from './docks';

describe('the docks around the world (#3031, ADR-0066, #3668)', () => {
	it('keeps the side columns, the seat and the stage clear of each other and of the rider', () => {
		const left = { x0: 0, y0: 0, x1: SIDE_MAX, y1: 1 };
		expect(meets(left, CORRIDOR), 'the left column in the corridor').toBe(
			false,
		);
		expect(meets(JUKEBOX_SEAT, CORRIDOR)).toBe(false);
		expect(meets(JUKEBOX_SEAT, RIDER_BOX)).toBe(false);
		expect(meets(STAGE, JUKEBOX_SEAT)).toBe(false);
		expect(meets(STAGE, left)).toBe(false);
	});

	it('puts the moment card top-centre only where it fits beside slot 1 (D12, Jan 2026-10-06)', () => {
		// 1440 × 900 with the sidebar: a 1200 px canvas, slot 1 about 800 px wide.
		expect(momentAt(1200, INSET_PX + 800)).toBe('seat');
		// 1920 × 1080: a 1680 px canvas.
		expect(momentAt(1680, INSET_PX + 800)).toBe('top');
		// The edge: exactly the card's floor free between the gaps.
		const slotRight = JUKEBOX_SEAT.x0 * 1680 - 2 * GAP_PX - MOMENT_MIN_PX;
		expect(momentAt(1680, slotRight)).toBe('top');
		expect(momentAt(1680, slotRight + 1)).toBe('seat');
	});
});
