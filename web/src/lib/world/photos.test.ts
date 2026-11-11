import { afterEach, describe, expect, it, vi } from 'vitest';
import { MaxRidePhotos } from '#lib/protocol.ts';
import { routeOfRoad } from './road-route';
import { legsRoad } from '#lib/road/fixtures.ts';
import { worldPicture, type WorldShots } from './picture.svelte';
import { dueToDraw, momentsFor } from './ride-moments';

const pair = (tag: string): WorldShots => ({
	rider: new Blob([`${tag}-you`]),
	above: new Blob([`${tag}-above`]),
});
const job = (n: number | null, shots: WorldShots | null) => ({
	n,
	shoot: () => Promise.resolve(shots),
});

/** A fetch that answers every PUT with `status`, and the URLs it was asked. */
function server(status = 204) {
	const puts: string[] = [];
	vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
		if (init?.method === 'PUT') puts.push(url);
		return status === 204
			? new Response(null, { status })
			: new Response(
					JSON.stringify({
						error: 'conflict',
						message: 'Your photos are full.',
					}),
					{ status, headers: { 'content-type': 'application/json' } },
				);
	});
	return puts;
}

afterEach(() => {
	worldPicture.clear();
	vi.unstubAllGlobals();
});

describe('the photos a rider takes (docs/spec/riding.md)', () => {
	it('numbers each photo and stops at the ride’s cap', () => {
		worldPicture.clear();
		const taken = Array.from({ length: MaxRidePhotos + 2 }, () =>
			worldPicture.took(),
		);
		expect(taken).toEqual([1, 2, 3, 4, 5, null, null]);
		expect(worldPicture.taken).toBe(MaxRidePhotos);
		expect(worldPicture.canTake).toBe(false);
	});

	it('draws the photos taken since the last close, and never one twice', () => {
		const moments = momentsFor({});
		const route = routeOfRoad(legsRoad([1000, 4]));
		moments.ridden.push({ m: 400, p: null, watts: 200 });
		// None taken: the best moment, at every close.
		expect(dueToDraw(moments, route).map((d) => d.n)).toEqual([null]);
		expect(dueToDraw(moments, route).map((d) => d.n)).toEqual([null]);
		moments.chosen.push({ m: 100, p: null, watts: 1 });
		moments.chosen.push({ m: 200, p: null, watts: 2 });
		expect(dueToDraw(moments, route)).toEqual([
			{ n: 1, at: { m: 100, p: null, watts: 1 } },
			{ n: 2, at: { m: 200, p: null, watts: 2 } },
		]);
		// The world opened and closed again with nothing new.
		expect(dueToDraw(moments, route)).toEqual([]);
		moments.chosen.push({ m: 300, p: null, watts: 3 });
		expect(dueToDraw(moments, route).map((d) => d.n)).toEqual([3]);
	});

	it('keeps each photo by its number, and offers the latest on the closing card', async () => {
		await worldPicture.drawAll([job(2, pair('b')), job(1, pair('a'))]);
		expect(worldPicture.photos.map((p) => p.n)).toEqual([1, 2]);
		expect(worldPicture.rider).toBe(worldPicture.photos[1].rider);
		// A close that drew nothing for a photo leaves it out, not blank.
		await worldPicture.drawAll([job(3, null)]);
		expect(worldPicture.photos).toHaveLength(2);
	});

	it('sends every view of every photo to the saved ride, once each, as they are drawn', async () => {
		const puts = server();
		await worldPicture.drawAll([job(1, pair('a'))]);
		expect(puts, 'nothing goes before the ride is saved').toEqual([]);
		await worldPicture.keepWith('ride-1');
		expect(puts).toEqual([
			'/api/rides/ride-1/photos/1/world',
			'/api/rides/ride-1/photos/1/overhead',
		]);
		await worldPicture.drawAll([
			job(2, { rider: pair('b').rider, above: null }),
		]);
		await vi.waitFor(() => expect(worldPicture.keeping.kept).toBe(2));
		expect(puts.slice(2)).toEqual(['/api/rides/ride-1/photos/2/world']);
		await worldPicture.keepWith('ride-1');
		expect(puts, 'the same ride again sends nothing twice').toHaveLength(3);
	});

	it('says when the server refuses one, and tries it again on Retry', async () => {
		server(409);
		await worldPicture.drawAll([job(1, pair('a'))]);
		await worldPicture.keepWith('ride-1');
		expect(worldPicture.keeping).toEqual({
			kept: 0,
			error: 'Your photos are full.',
		});
		const puts = server();
		await worldPicture.retry();
		expect(puts).toHaveLength(2);
		expect(worldPicture.keeping).toEqual({ kept: 1, error: null });
	});

	it('lets a late photo go once a new ride starts', async () => {
		const puts = server();
		const late = Promise.withResolvers<WorldShots | null>();
		void worldPicture.keepWith('ride-1');
		const drawing = worldPicture.drawAll([{ n: 1, shoot: () => late.promise }]);
		worldPicture.clear();
		late.resolve(pair('old'));
		await drawing;
		expect(worldPicture.photos).toEqual([]);
		expect(puts).toEqual([]);
	});
});
