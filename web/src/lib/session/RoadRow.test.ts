import { describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';
import RoadRow from './RoadRow.svelte';
import type { StoredRoute } from '$lib/road/stored';

const loadRoad = vi.fn((id: string) => new Promise(() => void id));
vi.mock('$lib/ride/roads', () => ({ loadRoad: (id: string) => loadRoad(id) }));

const route = (id: string, ownerOnly = false) =>
	({ id, name: `Road ${id}`, ownerOnly }) as StoredRoute;

const row = (chosen: string) =>
	render(RoadRow, {
		props: { routes: [route('r1'), route('r2', true)], chosen, road: null },
	}).body;

describe('the Road row (#4224)', () => {
	it('opens on the road the rider is already on, and reads it', () => {
		loadRoad.mockClear();
		expect(row('r1')).toMatch(/<option value="r1"[^>]*selected/);
		expect(loadRoad).toHaveBeenCalledWith('r1');
	});

	it('opens on no road when the one given is not offered here', () => {
		loadRoad.mockClear();
		for (const gone of ['r2', 'gone']) {
			expect(row(gone)).toMatch(/<option value=""[^>]*selected/);
		}
		expect(loadRoad).not.toHaveBeenCalled();
	});
});
