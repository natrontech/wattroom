import { describe, expect, it } from 'vitest';
import { chase } from '$lib/room/chase';

describe('chase', () => {
	it('seeks a big gap and nudges a small one', () => {
		expect(chase(120, 100, false)).toEqual({ do: 'seek', to: 120 });
		expect(chase(101, 100, false)).toEqual({ do: 'rate', rate: 1.25 });
		expect(chase(99, 100, false)).toEqual({ do: 'rate', rate: 0.75 });
	});

	it('plays straight inside the deadband', () => {
		expect(chase(100.2, 100, false)).toEqual({ do: 'rate', rate: 1 });
	});

	it('never seeks a livestream, however far the anchor has walked', () => {
		// The room anchor counts from the moment the stream was queued; the
		// player's clock is the stream's own. Chasing that seeks every tick.
		expect(chase(30, 7200, true)).toEqual({ do: 'rate', rate: 1 });
	});
});
