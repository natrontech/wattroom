import { describe, expect, it } from 'vitest';
import { hrShareView } from './hr-share';

describe('hrShareView (#2804, ADR-0008)', () => {
	it('names the trainer, the case the line exists for', () => {
		expect(hrShareView('trainer', true, true)).toEqual({
			shared: true,
			text: 'Heart rate from your trainer · shared with the call',
			action: 'Stop sharing',
			next: false,
		});
	});

	it('names a strap paired here', () => {
		expect(hrShareView('heart-rate', true, true)?.text).toBe(
			'Heart rate from your strap · shared with the call',
		);
	});

	it('stays up once stopped, offering it back', () => {
		expect(hrShareView('trainer', false, true)).toEqual({
			shared: false,
			text: 'Heart rate from your trainer · not shared',
			action: 'Share',
			next: true,
		});
	});

	it('draws nothing with no heart rate coming in', () => {
		expect(hrShareView(null, true, true)).toBeNull();
		expect(hrShareView(null, false, true)).toBeNull();
	});

	it("draws nothing where another screen's samples are the ones sent", () => {
		expect(hrShareView('trainer', true, false)).toBeNull();
	});
});
