import { describe, expect, it } from 'vitest';
import type { LiveChannel, LiveCrew, LiveOccupant } from '$lib/crews-live';
import { aroundNow, namedInCards } from './around-now';

const voice = (id: string, occupants?: LiveOccupant[]): LiveChannel => ({
	id,
	kind: 'voice',
	name: id,
	occupants,
});
const jan = { id: 'u-jan', name: 'Jan Lauber' };
const mike = { id: 'u-mike', name: 'Mike Frei' };
const sara = { id: 'u-sara', name: 'Sara' };

const crew = (id: string, channels: LiveChannel[]): LiveCrew => ({
	id,
	name: id,
	role: 'member',
	channels,
});

describe('aroundNow', () => {
	it('leaves you out, and a channel you stand in alone with it (#1502)', () => {
		const crews = [
			crew('c1', [voice('lounge', [jan]), voice('cave', [jan, mike])]),
		];
		const around = aroundNow(crews, 'u-jan');
		expect(around.map((a) => a.channel.id)).toEqual(['cave']);
		expect(around[0].others).toEqual([mike]);
	});

	it('lists every crew’s busy voice channels, in the read’s order, each with its crew', () => {
		const crews = [
			crew('c1', [voice('lounge', [mike]), voice('quiet', [])]),
			crew('c2', [voice('tuesday'), voice('backyard', [sara, mike])]),
		];
		expect(
			aroundNow(crews, 'u-jan').map((a) => [a.crew.id, a.channel.id]),
		).toEqual([
			['c1', 'lounge'],
			['c2', 'backyard'],
		]);
	});

	it('reads only voice channels: a text channel is nobody’s whereabouts', () => {
		const text: LiveChannel = {
			id: 'general',
			kind: 'text',
			name: 'general',
			occupants: [mike],
		};
		expect(aroundNow([crew('c1', [text])], 'u-jan')).toEqual([]);
	});

	it('is empty when nobody but you is anywhere', () => {
		expect(aroundNow([], 'u-jan')).toEqual([]);
		expect(aroundNow([crew('c1', [voice('lounge', [jan])])], 'u-jan')).toEqual(
			[],
		);
	});
});

// Home named a friend in voice twice (#2882 L6-11): in the channel's card and
// again as a chip below it. The chips skip whoever a card already names.
describe('namedInCards', () => {
	it('is everyone a card names besides you, across crews', () => {
		const crews = [
			crew('c1', [voice('cave', [jan, mike])]),
			crew('c2', [voice('lounge', [sara]), voice('empty', [])]),
		];
		const named = namedInCards(aroundNow(crews, 'u-jan'));
		expect([...named].sort()).toEqual(['u-mike', 'u-sara']);
	});
});
