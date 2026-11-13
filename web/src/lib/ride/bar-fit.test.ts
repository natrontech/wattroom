import { describe, expect, it } from 'vitest';
import { fitControls, GIVE_WAY, KEPT, type BarControl } from './bar-fit';

const row = (...ids: string[]): BarControl[] =>
	ids.map((id, at) => ({ key: `${id}#${at}`, id, width: 44 }));
const ids = (keys: string[]) => keys.map((key) => key.split('#')[0]);

describe('the ride bar fits its controls', () => {
	it('shows everything, and no More, when the row has the room', () => {
		const controls = row('mode', 'trim', 'flag', 'view', 'end');
		// 5 × 44 + 4 × 6
		const fit = fitControls(244, controls);
		expect(fit.more).toEqual([]);
		expect(ids(fit.shown)).toEqual(['mode', 'trim', 'flag', 'view', 'end']);
	});

	it('puts one control under More when one too many, and counts the More button', () => {
		const controls = row('mode', 'trim', 'tv', 'flag', 'end');
		// One short of everything: dropping tv alone frees 50 and More takes
		// 50, so flag goes too.
		expect(ids(fitControls(243, controls).more)).toEqual(['tv', 'flag']);
		// Dropping tv is enough once More fits in its place.
		const wide = row('mode', 'trim', 'tv', 'flag', 'end').map((c) =>
			c.id === 'tv' ? { ...c, width: 120 } : c,
		);
		expect(ids(fitControls(300, wide).more)).toEqual(['tv']);
	});

	it('gives way in the order of the list, the view switch last', () => {
		// Each wide enough that letting it go pays for the More button.
		const controls = row(
			'mode',
			'view',
			'skip',
			'camera',
			'workout',
			'end',
		).map((c) =>
			c.id === 'mode' || c.id === 'end' ? c : { ...c, width: 100 },
		);
		const order: string[] = [];
		for (let width = 518; width > 0; width -= 20) {
			for (const id of ids(fitControls(width, controls).more))
				if (!order.includes(id)) order.push(id);
		}
		expect(order).toEqual(['workout', 'camera', 'skip', 'view']);
	});

	it('never puts End, the trim or the mode switch under More, however narrow', () => {
		const controls = row(...GIVE_WAY, ...KEPT);
		const fit = fitControls(0, controls);
		expect(ids(fit.shown).sort()).toEqual([...KEPT].sort());
		expect(ids(fit.more)).toEqual([...GIVE_WAY]);
	});

	it('drops the later of two alike first, and an unnamed control before the view switch', () => {
		const controls = row('ride-with', 'ride-with', '', 'view', 'end').map(
			(c) => (c.id === 'end' ? c : { ...c, width: 100 }),
		);
		const order: string[] = [];
		for (let width = 468; width > 0; width -= 20)
			for (const key of fitControls(width, controls).more)
				if (!order.includes(key)) order.push(key);
		expect(order).toEqual(['ride-with#1', 'ride-with#0', '#2', 'view#3']);
	});
});
