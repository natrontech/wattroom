import { describe, expect, it } from 'vitest';
import {
	REACH_FLAGS,
	REACH_LABELS,
	REACH_ORDER,
	reachLabel,
	reachOf,
	reachSteps,
} from './reach';

describe('reachOf', () => {
	it('reads the two columns back as one step', () => {
		expect(reachOf(false, false)).toBe('members');
		expect(reachOf(false, true)).toBe('crew');
		expect(reachOf(true, true)).toBe('everyone');
	});

	// Listed but hidden from its own crew is not a state anyone means; the
	// ladder still has to place it, and the directory is the wider reach.
	it('treats a listed room as everyone even with the crew shut', () => {
		expect(reachOf(true, false)).toBe('everyone');
	});

	it('round-trips every step through its flags', () => {
		for (const step of REACH_ORDER) {
			const { listed, crewVisible } = REACH_FLAGS[step];
			expect(reachOf(listed, crewVisible)).toBe(step);
		}
	});
});

describe('reachSteps', () => {
	it('walks the ladder bottom to top', () => {
		expect(reachSteps().map((s) => s.key)).toEqual([
			'members',
			'crew',
			'everyone',
		]);
	});

	it('names the crew where the surface knows it', () => {
		expect(reachLabel('crew')).toBe('Open to the crew');
		expect(reachLabel('crew', 'Natron')).toBe('Open to the crew — Natron');
	});

	it('leaves the other steps alone when a crew is named', () => {
		const steps = reachSteps('Natron');
		expect(steps[0].label).toBe(REACH_LABELS.members);
		expect(steps[2].label).toBe(REACH_LABELS.everyone);
	});

	it('carries a hint with every label', () => {
		for (const step of reachSteps()) {
			expect(step.label).not.toBe('');
			expect(step.hint).not.toBe('');
		}
	});
});

// The whole point of the module (#2007): the crew row's toggle and the room's
// own ladder say the same words, so a rider who flipped the setting in one
// place recognises it in the other. A rename here moves both.
describe('the crew row and the room settings share one vocabulary', () => {
	it('labels the shut step the way the crew row offers it', () => {
		expect(REACH_LABELS.members).toBe('Only its members');
	});

	it('labels the crew step the way the crew row offers it', () => {
		expect(REACH_LABELS.crew).toBe('Open to the crew');
	});

	it('has a label for every step of the ladder', () => {
		expect(Object.keys(REACH_LABELS).sort()).toEqual(
			[...REACH_ORDER].sort() as string[],
		);
	});
});
