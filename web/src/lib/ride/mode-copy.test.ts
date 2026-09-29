import { describe, expect, it } from 'vitest';
import {
	MODE_LINES,
	modeLine,
	ONE_GEAR_LINE,
	ONE_GEAR_SETTING,
} from './mode-copy';

// Pinned (#3203): the same words serve the channel's free ride, /ride's
// free-ride card (#3027) and Settings › Equipment.
describe('what the free ride modes say', () => {
	it('says what each mode does', () => {
		expect(MODE_LINES).toEqual({
			grade: 'You set the slope and shift your own gears (SIM).',
			watts: 'The trainer holds your watts whatever your cadence (ERG).',
		});
	});

	it('warns a one-gear rider off grade, and only in grade', () => {
		expect(ONE_GEAR_LINE).toBe(
			'One gear: the grade has no range here, use Watts.',
		);
		expect(modeLine('grade', true)).toBe(ONE_GEAR_LINE);
		expect(modeLine('grade', false)).toBe(MODE_LINES.grade);
		expect(modeLine('watts', true)).toBe(MODE_LINES.watts);
	});

	it('names the setting by what it does', () => {
		expect(ONE_GEAR_SETTING).toEqual({
			label: "One gear (Zwift Cog), or don't make me shift",
			hint: 'WattRoom holds watts wherever it would put you on a slope.',
		});
	});
});
