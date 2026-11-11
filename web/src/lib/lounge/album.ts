/**
 * The crew's album of rare visitors (moments.ts): each one's name and its
 * cryptic hint, and the crew's list of who has come by.
 */
import { api } from '#lib/api.ts';
import type { Visitor } from '#lib/lounge/moments.ts';

export interface Sighting {
	kind: string;
	seenAt: string;
}

export const VISITOR_NOTES: Record<Visitor, { name: string; hint: string }> = {
	fox: { name: 'Fox', hint: 'Snow falls, and everyone has gone to bed.' },
	cow: { name: 'Cow', hint: 'A clear day. Listen for the bell.' },
	star: { name: 'Shooting star', hint: 'Clear nights are for wishing.' },
	rainbow: { name: 'Rainbow', hint: 'Rain on a bright day.' },
	snail: { name: 'Snail', hint: 'It likes the sill wet and the light low.' },
	hedgehog: { name: 'Hedgehog', hint: 'Autumn, once the light goes.' },
	mouse: { name: 'Mouse', hint: 'Turn the lamp off and sit still.' },
	ibex: { name: 'Ibex', hint: 'A snow day. Look up.' },
	sleigh: { name: 'Sleigh', hint: 'One night of the year.' },
	bat: { name: 'Bat', hint: 'The week before Halloween, after dark.' },
	drone: { name: 'Delivery drone', hint: 'Friday night. Somebody ordered.' },
	marmot: { name: 'Marmot', hint: 'Spring wakes the sleepers.' },
};

export async function fetchAlbum(crew: string): Promise<Sighting[]> {
	const res = await api<{ sightings: Sighting[] }>(
		`/api/crews/${crew}/sightings`,
	);
	return res.ok ? res.data.sightings : [];
}

export const saveSighting = (crew: string, kind: Visitor) =>
	api(`/api/crews/${crew}/sightings`, { method: 'POST', json: { kind } });
