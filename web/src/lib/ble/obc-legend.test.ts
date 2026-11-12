import { describe, expect, it } from 'vitest';
import { OBC_BUTTONS, WATTROOM_APP_INFO } from './obc';
import { OBC_NAMES, obcLegend } from './obc-legend';

/** The IDs App Information tells a controller WattRoom answers. */
const advertised = [...WATTROOM_APP_INFO.slice(13)];

describe('the Controllers page’s button legend (#4547)', () => {
	it('names every ID WattRoom advertises', () => {
		for (const id of advertised) expect(OBC_NAMES[id]?.action).toBeTruthy();
	});

	it('lists every advertised action once, and every action WattRoom runs', () => {
		const rows = obcLegend();
		const sent = rows.flatMap((row) => row.sends);
		expect(sent.toSorted()).toEqual(
			advertised.map((id) => OBC_NAMES[id].action).toSorted(),
		);
		expect(rows.map((row) => row.action).toSorted()).toEqual(
			[...new Set(Object.values(OBC_BUTTONS))].toSorted(),
		);
	});

	it('gives the Click V2’s buttons where BikeControl sends one', () => {
		const row = (action: string) =>
			obcLegend().find((r) => r.action === action);
		expect(row('harder')).toMatchObject({
			sends: ['Shift Up', 'Increase Difficulty'],
			click: ['+'],
		});
		expect(row('page-prev')).toMatchObject({
			sends: ['Up', 'Left', 'Steer Left'],
			click: ['↑', '←'],
		});
		expect(row('details')?.click).toEqual(['A']);
		expect(row('back')?.click).toEqual(['B']);
		expect(row('next-view')).toMatchObject({ sends: ['Menu'], click: ['Y'] });
		expect(row('talk')).toMatchObject({ sends: ['Push to Talk'], click: [] });
	});

	it('drops an action nothing sends', () => {
		expect(obcLegend({ 0x01: 'harder' }).map((r) => r.action)).toEqual([
			'harder',
		]);
	});
});
