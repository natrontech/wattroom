import { afterEach, describe, expect, it, vi } from 'vitest';
import { deletePhoto, photoFilename, type RidePhoto } from './photos';

const photo: RidePhoto = {
	n: 2,
	views: ['overhead', 'world'],
	savedAt: '2026-11-11T07:00:00Z',
};

/** A server holding photo 2's two views, and every request it saw. */
function server(opts: { readFails?: boolean } = {}) {
	const seen: string[] = [];
	const bodies = new Map<string, unknown>();
	vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
		const method = init?.method ?? 'GET';
		seen.push(`${method} ${url}`);
		if (method === 'GET') {
			if (opts.readFails)
				return new Response(
					JSON.stringify({ error: 'internal_error', message: 'Down.' }),
					{ status: 500 },
				);
			return new Response(new Blob([url]), {
				headers: { 'content-type': 'image/jpeg' },
			});
		}
		if (method === 'PUT') bodies.set(url, init?.body);
		return new Response(null, { status: 204 });
	});
	return { seen, bodies };
}

afterEach(() => vi.unstubAllGlobals());

describe('deleting a ride photo, with its undo', () => {
	it('reads both views first, then deletes, and Undo puts the same bytes back', async () => {
		const { seen, bodies } = server();
		const res = await deletePhoto('r1', photo);
		expect(res.ok).toBe(true);
		expect(seen).toEqual([
			'GET /api/rides/r1/photos/2/overhead',
			'GET /api/rides/r1/photos/2/world',
			'DELETE /api/rides/r1/photos/2',
		]);
		if (!res.ok) return;
		expect((await res.data.restore()).ok).toBe(true);
		expect(seen.slice(3)).toEqual([
			'PUT /api/rides/r1/photos/2/overhead',
			'PUT /api/rides/r1/photos/2/world',
		]);
		const back = bodies.get('/api/rides/r1/photos/2/world') as Blob;
		expect(await back.text()).toBe('/api/rides/r1/photos/2/world');
	});

	it('deletes nothing when it cannot keep the bytes for the undo', async () => {
		const { seen } = server({ readFails: true });
		const res = await deletePhoto('r1', photo);
		expect(res.ok).toBe(false);
		expect(seen.some((s) => s.startsWith('DELETE'))).toBe(false);
	});
});

describe('a ride photo’s file name', () => {
	it.each([
		['world', 'wattroom-2026-11-11-photo-2.jpg'],
		['overhead', 'wattroom-2026-11-11-photo-2-overhead.jpg'],
	] as const)('%s', (view, want) => {
		expect(photoFilename('2026-11-11T07:00:00Z', 2, view)).toBe(want);
	});
});
