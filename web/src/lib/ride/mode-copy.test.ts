import { describe, expect, it } from 'vitest';
import { ONE_GEAR_LINE, ONE_GEAR_SETTING } from './mode-copy';

// Pinned (#3203): the same words serve the free ride's one-gear hint and
// Settings › Equipment.
describe('what the free ride says', () => {
	it('warns a one-gear rider off grade', () => {
		expect(ONE_GEAR_LINE).toBe(
			'One gear: the grade has no range here, use Watts.',
		);
	});

	it('names the setting by what it does', () => {
		expect(ONE_GEAR_SETTING).toEqual({
			label: "One gear (Zwift Cog), or don't make me shift",
			hint: 'WattRoom holds watts wherever it would put you on a slope.',
		});
	});
});
