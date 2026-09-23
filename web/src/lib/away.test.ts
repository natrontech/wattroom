import { describe, expect, it } from 'vitest';
import { AWAY_CHOICES, AWAY_STATES, awayLineFor, awayState } from '$lib/away';

describe('away states', () => {
	// The menu is the named states only: plain Away is the button's face, and
	// offering it in the menu as well would be the same thing twice.
	it('leaves plain away out of the menu', () => {
		expect(AWAY_CHOICES).not.toContain('');
		expect(AWAY_CHOICES).toEqual(['nature', 'food', 'shower']);
	});

	// Every key the server may send has all four of its words here, or a voice
	// channel draws a blank mark and writes a blank line for a state it
	// accepted.
	it('gives every state a label, an icon and a line', () => {
		for (const key of ['', ...AWAY_CHOICES] as const) {
			const state = AWAY_STATES[key];
			expect(state.label, key).toBeTruthy();
			expect(state.icon, key).toBeTruthy();
			expect(state.line('Kim'), key).toContain('Kim');
		}
	});

	// A newer server's word still means "away": the rider is out either way,
	// and that is the part the voice channel needs to see.
	it('falls back to the plain cup for a word it does not know', () => {
		expect(awayState('sauna')).toBe(AWAY_STATES['']);
		expect(awayState(undefined)).toBe(AWAY_STATES['']);
		expect(awayState('')).toBe(AWAY_STATES['']);
		expect(awayState('shower')).toBe(AWAY_STATES.shower);
	});

	// The timeline's verbs, which the server writes as away/away_<reason>.
	it('writes one sentence per verb', () => {
		expect(awayLineFor('away', 'Kim')).toBe('Kim went away');
		expect(awayLineFor('away_food', 'Kim')).toBe('Kim is refuelling');
		expect(awayLineFor('away_shower', 'Kim')).toBe('Kim is showering');
		expect(awayLineFor('away_nature', 'Kim')).toBe(
			'Kim is taking a nature break',
		);
	});

	// An unknown verb draws no line rather than a wrong one — the voice channel
	// would rather be quiet than say something the server did not mean.
	it('writes nothing for a verb it does not know', () => {
		expect(awayLineFor('away_sauna', 'Kim')).toBeUndefined();
		expect(awayLineFor('queued', 'Kim')).toBeUndefined();
	});
});
