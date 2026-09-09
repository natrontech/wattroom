import { describe, expect, it } from 'vitest';
import { load as loadHistory, type HistoryPageData } from './history/+page';
import { load as loadSettings } from './settings/+layout';
import { load as loadData } from './settings/data/+page';
import {
	load as loadProfile,
	type ProfilePageData,
} from './settings/profile/+page';
import { load as loadRoom } from './r/[slug]/+layout';
import { load as loadRider, type RiderPageData } from './u/[id]/+page';
import type { RoomLoadData } from '$lib/room/room-data';

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

	// Settings is a tree now (#1330): each section loads only what it draws,
	// and the version footer is the layout's.
	it('the Profile section loads the trend and nothing else', async () => {
		const { fetch, calls } = fetchMap({ '/api/progression': { rides: [] } });
		const data = (await loadProfile({ fetch } as never)) as ProfilePageData;
		expect(calls).toEqual(['/api/progression']);
		expect(data.trend).toEqual([]);
	});

	it('the Your data section loads the tokens', async () => {
		const { fetch, calls } = fetchMap({ '/api/tokens': { tokens: [] } });
		const data = (await loadData({ fetch } as never)) as { tokens: unknown[] };
		expect(calls).toEqual(['/api/tokens']);
		expect(data.tokens).toEqual([]);
	});

	it('the settings layout reads the build for its footer', async () => {
		const { fetch } = fetchMap({
			'/api/version': { commit: 'abc123', version: '2026.09.1' },
		});
		const data = (await loadSettings({ fetch } as never)) as {
			version: string | null;
			release: string | null;
		};
		expect(data.version).toBe('abc123');
		expect(data.release).toBe('2026.09.1');
	});

	it('starts the room request before the page mounts', async () => {
		const room = { slug: 'mfw', name: 'Midnight Fast Wheels' };
		const { fetch, calls } = fetchMap({ '/api/rooms/mfw': room });
		const data = (await loadRoom({
			fetch,
			params: { slug: 'mfw' },
		} as never)) as RoomLoadData;

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
