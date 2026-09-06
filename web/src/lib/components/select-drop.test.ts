import { describe, expect, it } from 'vitest';
import { dropsUp } from './select-drop';

describe('dropsUp', () => {
	const cases: [string, { top: number; bottom: number }, number, boolean][] = [
		['room below — stays down', { top: 100, bottom: 144 }, 900, false],
		[
			'bottom of a tall dialog — flips up',
			{ top: 1000, bottom: 1044 },
			1100,
			true,
		],
		['no room either way — stays down', { top: 120, bottom: 164 }, 400, false],
		[
			'exactly enough below — stays down',
			{ top: 300, bottom: 312 },
			600,
			false,
		],
	];
	for (const [name, trigger, viewport, expected] of cases) {
		it(name, () => expect(dropsUp(trigger, viewport)).toBe(expected));
	}
});
