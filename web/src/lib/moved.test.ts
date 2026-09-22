import { isRedirect } from '@sveltejs/kit';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { followRoomLink, movedTo, type MovedRoom } from './moved';

const toasted = vi.hoisted(() => [] as string[]);
vi.mock('$lib/toast.svelte', () => ({
	toasts: { push: (text: string) => toasted.push(text) },
}));

const moved: MovedRoom = {
	crewId: 'crew-1',
	textChannelId: 'text-1',
	voiceChannelId: 'voice-1',
};

describe('movedTo', () => {
	// Every old room path lands somewhere (#2458).
	it.each([
		['', '/crew/crew-1/c/text-1'],
		['chat', '/crew/crew-1/c/text-1'],
		['training', '/crew/crew-1/v/voice-1'],
		['watch', '/crew/crew-1/v/voice-1'],
		['sessions', '/crew/crew-1/schedule'],
		['members', '/crew/crew-1/members'],
		['settings', '/crew/crew-1/settings'],
		['board', '/crew/crew-1/board'],
		['pins', '/crew/crew-1/board'],
		['something/else', '/crew/crew-1/c/text-1'],
	])('/r/…/%s → %s', (place, want) => {
		expect(movedTo(moved, place)).toBe(want);
	});

	it('sends the ride to the session running in the voice channel', () => {
		expect(movedTo(moved, 'training', 'sess-9')).toBe('/crew/crew-1/s/sess-9');
		expect(movedTo(moved, 'watch', 'sess-9')).toBe('/crew/crew-1/s/sess-9');
		expect(movedTo(moved, 'chat', 'sess-9')).toBe('/crew/crew-1/c/text-1');
	});

	it('falls back to the crew when a channel is gone', () => {
		const bare = { crewId: 'crew-1' };
		expect(movedTo(bare, '')).toBe('/crew/crew-1');
		expect(movedTo(bare, 'training')).toBe('/crew/crew-1');
	});
});

function server(routes: Record<string, [number, unknown]>) {
	const calls: string[] = [];
	const fetcher = (async (input: RequestInfo | URL) => {
		const path = String(input);
		calls.push(path);
		const [status, body] = routes[path] ?? [
			404,
			{ error: 'not_found', message: 'no' },
		];
		return new Response(JSON.stringify(body), {
			status,
			headers: { 'content-type': 'application/json' },
		});
	}) as typeof fetch;
	return { fetcher, calls };
}

async function landing(p: Promise<never>): Promise<string> {
	try {
		await p;
	} catch (e) {
		if (isRedirect(e)) return e.location;
		throw e;
	}
	throw new Error('no redirect');
}

describe('followRoomLink', () => {
	beforeEach(() => {
		toasted.length = 0;
	});

	it('asks once where the room went and goes there', async () => {
		const { fetcher, calls } = server({ '/api/moved/r/mfw-5': [200, moved] });
		const to = await landing(
			followRoomLink(
				fetcher,
				'mfw-5',
				'members',
				new URL('http://x/r/mfw-5/members'),
			),
		);
		expect(to).toBe('/crew/crew-1/members');
		expect(calls).toEqual(['/api/moved/r/mfw-5']);
	});

	it('finds the session running in the voice channel for the ride', async () => {
		const { fetcher } = server({
			'/api/moved/r/mfw-5': [200, moved],
			'/api/crews/crew-1/live': [
				200,
				{
					sessions: [
						{ id: 'other', channel: 'voice-2' },
						{ id: 'sess-9', channel: 'voice-1' },
					],
				},
			],
		});
		const to = await landing(
			followRoomLink(
				fetcher,
				'mfw-5',
				'training',
				new URL('http://x/r/mfw-5/training'),
			),
		);
		expect(to).toBe('/crew/crew-1/s/sess-9');
	});

	it('lands on the voice channel when the live list cannot be read', async () => {
		const { fetcher } = server({
			'/api/moved/r/mfw-5': [200, moved],
			'/api/crews/crew-1/live': [
				500,
				{ error: 'internal_error', message: 'down' },
			],
		});
		const to = await landing(
			followRoomLink(
				fetcher,
				'mfw-5',
				'watch',
				new URL('http://x/r/mfw-5/watch'),
			),
		);
		expect(to).toBe('/crew/crew-1/v/voice-1');
	});

	it('takes a signed-out rider through sign-in and back to the old link', async () => {
		const { fetcher } = server({
			'/api/moved/r/mfw-5': [
				401,
				{ error: 'unauthorized', message: 'Sign in.' },
			],
		});
		const to = await landing(
			followRoomLink(
				fetcher,
				'mfw-5',
				'chat',
				new URL('http://x/r/mfw-5/chat?t=1'),
			),
		);
		expect(to).toBe(`/login?next=${encodeURIComponent('/r/mfw-5/chat?t=1')}`);
		expect(toasted).toEqual([]);
	});

	it('lands a link to nothing on Home, and says so', async () => {
		const { fetcher } = server({
			'/api/moved/r/gone': [
				404,
				{ error: 'not_found', message: 'Nothing lives at this link any more.' },
			],
		});
		const to = await landing(
			followRoomLink(fetcher, 'gone', '', new URL('http://x/r/gone')),
		);
		expect(to).toBe('/home');
		expect(toasted).toEqual(['Nothing lives at this link any more.']);
	});
});
