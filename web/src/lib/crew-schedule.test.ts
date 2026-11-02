import { afterEach, describe, expect, it, vi } from 'vitest';
import { confirm } from '$lib/confirm.svelte';
import {
	crewCalendarLink,
	mayRearrange,
	planCrewSession,
	planPlace,
} from './crew-schedule';

vi.mock('$lib/confirm.svelte', () => ({ confirm: vi.fn() }));

describe('crew schedule (#2452)', () => {
	it('says where a plan runs, or that it names no channel yet', () => {
		expect(planPlace({ channelName: 'Pain Cave' })).toBe('in Pain Cave');
		expect(planPlace({})).toBe('no voice channel yet');
	});

	// The matrix's "move / cancel": a member their own, the owner and admins
	// any plan — the page must not offer a button the server refuses.
	it('offers move and cancel to whoever the server lets', () => {
		expect(mayRearrange({ mine: true }, 'member')).toBe(true);
		expect(mayRearrange({}, 'member')).toBe(false);
		expect(mayRearrange({}, 'admin')).toBe(true);
		expect(mayRearrange({}, 'owner')).toBe(true);
	});

	it('builds the feed URL a calendar app subscribes to', () => {
		expect(crewCalendarLink('https://wattroom.ch', 'c1', 'tok')).toBe(
			'https://wattroom.ch/api/crews/c1/calendar/tok.ics',
		);
	});
});

// A crew listed in the directory asks first (#4149, ADR-0063): a plan on a
// road the server held back asks the planner, records a yes, and plans
// again; a no plans nothing and records nothing.
describe('planning a road into a listed crew', () => {
	const plan = {
		workoutName: 'Road',
		workoutJson: JSON.stringify({ road: { routeId: 'r1' }, steps: [] }),
		startsAt: '2026-11-03T18:00:00Z',
	};
	const ask = 'Anyone who joins Velvet will see this route.';
	const json = (status: number, body: unknown) =>
		new Response(JSON.stringify(body), {
			status,
			headers: { 'content-type': 'application/json' },
		});
	afterEach(() => vi.unstubAllGlobals());

	function serve() {
		const calls: { url: string; method?: string; body?: unknown }[] = [];
		vi.stubGlobal(
			'fetch',
			vi.fn(async (url: string, init?: RequestInit) => {
				calls.push({
					url,
					method: init?.method,
					body: init?.body && JSON.parse(String(init.body)),
				});
				if (init?.method === 'PUT') return new Response(null, { status: 204 });
				return calls.some((c) => c.method === 'PUT')
					? json(201, { id: 'p1' })
					: json(403, { error: 'forbidden', message: ask, field: 'consent' });
			}),
		);
		return calls;
	}

	it('asks, shares on a yes and plans again', async () => {
		const calls = serve();
		vi.mocked(confirm).mockResolvedValueOnce(true);
		const res = await planCrewSession('c1', plan);
		expect(res.ok).toBe(true);
		expect(vi.mocked(confirm)).toHaveBeenCalledWith(
			expect.objectContaining({ body: ask }),
		);
		expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
			'POST /api/crews/c1/schedule',
			'PUT /api/routes/r1/crews/c1',
			'POST /api/crews/c1/schedule',
		]);
		expect(calls[1].body).toEqual({ shared: true });
	});

	it('plans nothing on a no', async () => {
		const calls = serve();
		vi.mocked(confirm).mockResolvedValueOnce(false);
		const res = await planCrewSession('c1', plan);
		expect(res.ok).toBe(false);
		expect(calls).toHaveLength(1);
	});
});
