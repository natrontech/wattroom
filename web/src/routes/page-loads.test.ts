import { describe, expect, it } from 'vitest';
import {
	load as loadHistory,
	type HistoryPageData,
} from './history/+page';
import { load as loadProfile, type ProfilePageData } from './profile/+page';
import { load as loadRoom, type RoomPageData } from './r/[slug]/+page';
import { load as loadRider, type RiderPageData } from './u/[id]/+page';

function fetchMap(
	responses: Record<string, unknown>,
	status = 200,
): { fetch: typeof fetch; calls: string[] } {
	const calls: string[] = [];
	return {
		calls,
		fetch: async (input) => {
			const path = String(input);
			calls.push(path);
			return new Response(JSON.stringify(responses[path]), {
				status,
				headers: { 'content-type': 'application/json' },
			});
		},
	};
}

describe('route page loads', () => {
	it('starts history requests together and returns their data', async () => {
		const { fetch, calls } = fetchMap({
			'/api/rides': { rides: [] },
			'/api/progression': { rides: [], curve: {}, category: 'D', wkg: 0 },
		});
		const data = (await loadHistory({ fetch } as never)) as HistoryPageData;

		expect(calls).toEqual(['/api/rides', '/api/progression']);
		expect(data.rides).toEqual([]);
		expect(data.progression?.category).toBe('D');
	});

	it('starts profile requests together and returns their data', async () => {
		const { fetch, calls } = fetchMap({
			'/api/progression': { rides: [] },
			'/api/tokens': { tokens: [] },
			'/api/version': { commit: 'abc123', version: '2026.09.1' },
		});
		const data = (await loadProfile({ fetch } as never)) as ProfilePageData;

		expect(calls).toEqual([
			'/api/progression',
			'/api/tokens',
			'/api/version',
		]);
		expect(data.trend).toEqual([]);
		expect(data.tokens).toEqual([]);
		expect(data.version).toBe('abc123');
		expect(data.release).toBe('2026.09.1');
	});

	it('starts the room request before the page mounts', async () => {
		const room = { slug: 'mfw', name: 'Midnight Fast Wheels' };
		const { fetch, calls } = fetchMap({ '/api/rooms/mfw': room });
		const data = (await loadRoom({
			fetch,
			params: { slug: 'mfw' },
		} as never)) as RoomPageData;

		expect(calls).toEqual(['/api/rooms/mfw']);
		expect(data.room).toEqual(room);
	});

	it('starts rider and trophy requests together', async () => {
		const rider = { id: 'rider-1', displayName: 'Rider' };
		const trophies = { achievements: [] };
		const { fetch, calls } = fetchMap({
			'/api/riders/rider-1': rider,
			'/api/riders/rider-1/trophies': trophies,
		});
		const data = (await loadRider({
			fetch,
			params: { id: 'rider-1' },
		} as never)) as RiderPageData;

		expect(calls).toEqual([
			'/api/riders/rider-1',
			'/api/riders/rider-1/trophies',
		]);
		expect(data.rider).toEqual(rider);
		expect(data.trophies).toEqual(trophies);
	});
});
