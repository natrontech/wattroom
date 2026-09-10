// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The library warms its pads through the audio bus, which wants an
// AudioContext this environment has not got. Nothing here is about sound.
vi.mock('$lib/sound/board.svelte', () => ({ prefetch: () => {} }));

const {
	assign,
	bindKey,
	board,
	movePad,
	nameFromFile,
	remove,
	rename,
	saveEdit,
	upload,
} = await import('$lib/board/clips.svelte');

describe('nameFromFile', () => {
	it('drops the extension and shouts, because a pad is read at arm’s length', () => {
		expect(nameFromFile('airhorn.mp3')).toBe('AIRHORN');
		expect(nameFromFile('cowbell-hit.MP3')).toBe('COWBELL-HIT');
	});

	it('keeps a name inside what the server accepts', () => {
		expect(nameFromFile(`${'a'.repeat(80)}.mp3`)).toHaveLength(32);
	});

	it('only drops the last extension', () => {
		expect(nameFromFile('sprint.count.mp3')).toBe('SPRINT.COUNT');
	});

	it('never hands the server an empty name', () => {
		expect(nameFromFile('.mp3')).toBe('CLIP');
		expect(nameFromFile('   ')).toBe('CLIP');
	});
});

/**
 * The refusal paths, which is the whole point of these calls going through
 * `$lib/api` (#1997): the rider is meant to read the server's sentence, not a
 * hand-rolled one, and never a board that looks empty when it is only unread.
 *
 * These run before the movePad block on purpose — the module's `loaded` flag
 * is session state, and this is the only place that sees it still false.
 */
describe('a refused load', () => {
	afterEach(() => vi.unstubAllGlobals());

	it('leaves the board unloaded, so nothing draws the empty state', async () => {
		vi.stubGlobal(
			'fetch',
			async () =>
				new Response(
					JSON.stringify({ error: 'unauthorized', message: 'Sign in again.' }),
					{ status: 401, headers: { 'content-type': 'application/json' } },
				),
		);
		await board.load();
		expect(board.loaded).toBe(false);
		expect(board.clips).toEqual([]);
	});

	// `load()` memoises the in-flight promise; a failure that latched would
	// leave the board unloadable for the rest of the session.
	it('can be asked again once the server is back', async () => {
		vi.stubGlobal('fetch', async () => {
			throw new TypeError('Failed to fetch');
		});
		await board.load();
		expect(board.loaded).toBe(false);

		vi.stubGlobal(
			'fetch',
			async () =>
				new Response(
					JSON.stringify({
						clips: [{ id: 'a', name: 'AIRHORN', pad: 1, millis: 1000 }],
						used: 1,
						limit: 10,
					}),
					{ status: 200, headers: { 'content-type': 'application/json' } },
				),
		);
		await board.load();
		expect(board.loaded).toBe(true);
		expect(board.clips).toHaveLength(1);
	});
});

describe('a refused write', () => {
	let calls: string[] = [];

	/** Answers every request with one refusal, and records what was asked. */
	function refuse(status: number, body: BodyInit | null) {
		calls = [];
		vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
			calls.push(`${init?.method ?? 'GET'} ${url}`);
			return new Response(body, {
				status,
				headers: { 'content-type': 'application/json' },
			});
		});
	}

	const said = (message: string) =>
		JSON.stringify({ error: 'validation_error', message });

	afterEach(() => vi.unstubAllGlobals());

	it('hands the rider the server’s own sentence, not a guess', async () => {
		// ADR-0033: the server owns size, length and quota, so its refusal is
		// the only copy of the rule.
		refuse(409, said('That would put you over your 50 MB of clips.'));
		await expect(
			upload(new File(['x'], 'airhorn.mp3', { type: 'audio/mpeg' })),
		).resolves.toEqual({
			message: 'That would put you over your 50 MB of clips.',
		});

		refuse(400, said('A clip needs a name.'));
		await expect(rename('a', '')).resolves.toEqual({
			message: 'A clip needs a name.',
		});

		refuse(400, said('A fade cannot outlast the clip.'));
		await expect(
			saveEdit('a', {
				startMs: 0,
				endMs: 0,
				gainDb: 0,
				fadeInMs: 9999,
				fadeOutMs: 0,
			}),
		).resolves.toEqual({ message: 'A fade cannot outlast the clip.' });

		refuse(400, said('That key is not one you can bind.'));
		await expect(bindKey('a', 'F13')).resolves.toEqual({
			message: 'That key is not one you can bind.',
		});
	});

	// A proxy's HTML 502 used to reach the rider as "undefined".
	it('still says something when the refusal is not even JSON', async () => {
		refuse(502, '<html>Bad Gateway</html>');
		await expect(rename('a', 'AIRHORN')).resolves.toEqual({
			message: 'The server did not answer properly.',
		});
	});

	it('names the network when the server is simply not there', async () => {
		vi.stubGlobal('fetch', async () => {
			throw new TypeError('Failed to fetch');
		});
		await expect(bindKey('a', '1')).resolves.toEqual({
			message: 'The server is not reachable.',
		});
	});

	// The server is the truth after a write (`board.refresh`), so a write that
	// never landed must not send the board back for a re-read it does not need.
	it('does not re-read the board after a write that failed', async () => {
		refuse(403, said('That clip is not yours.'));
		await rename('a', 'AIRHORN');
		await saveEdit('a', {
			startMs: 0,
			endMs: 0,
			gainDb: 0,
			fadeInMs: 0,
			fadeOutMs: 0,
		});
		await bindKey('a', '1');
		await assign('a', 2);
		await remove('a');
		expect(calls).toEqual([
			'PUT /api/board/clips/a/name',
			'PUT /api/board/clips/a/edit',
			'PUT /api/board/clips/a/key',
			'PUT /api/board/clips/a/pad',
			'DELETE /api/board/clips/a',
		]);
	});
});

/**
 * Moving a clip onto an occupied pad used to bump the occupant into the
 * library, silently and with no undo, so a rider tidying their board knocked
 * clips off it (#981). It is a swap now.
 */
describe('movePad', () => {
	const clips = [
		{ id: 'a', name: 'AIRHORN', pad: 1, millis: 1000 },
		{ id: 'b', name: 'COWBELL', pad: 2, millis: 1000 },
		{ id: 'c', name: 'KLAXON', millis: 1000 },
	];
	let puts: { id: string; pad: number | null }[] = [];

	beforeEach(async () => {
		puts = [];
		vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
			const put = /\/api\/board\/clips\/(\w+)\/pad$/.exec(url);
			if (put) {
				const pad = JSON.parse(String(init?.body)).pad as number | null;
				puts.push({ id: put[1], pad });
				const moving = clips.find((c) => c.id === put[1])!;
				// The server frees the unique index first: whatever is on the
				// target pad is bumped to the library before the write lands.
				if (pad !== null)
					for (const c of clips)
						if (c.pad === pad && c !== moving)
							delete (c as { pad?: number }).pad;
				if (pad === null) delete (moving as { pad?: number }).pad;
				else (moving as { pad?: number }).pad = pad;
				return { ok: true, status: 204 };
			}
			return { ok: true, json: async () => ({ clips, used: 0, limit: 1 }) };
		});
		await board.refresh();
	});
	afterEach(() => vi.unstubAllGlobals());

	it('swaps, so neither clip leaves the board', async () => {
		await movePad('a', 2);
		expect(puts).toEqual([
			{ id: 'a', pad: 2 },
			{ id: 'b', pad: 1 },
		]);
		expect(board.onPad(2)?.id).toBe('a');
		expect(board.onPad(1)?.id).toBe('b');
	});

	it('just moves onto an empty pad', async () => {
		await movePad('a', 5);
		expect(puts).toEqual([{ id: 'a', pad: 5 }]);
	});

	// A clip coming off the library has no pad to hand back, so the one it
	// displaces goes to the library the way it always did.
	it('does not hand a pad to the displaced clip when the mover had none', async () => {
		await movePad('c', 2);
		expect(puts).toEqual([{ id: 'c', pad: 2 }]);
	});

	it('takes a clip off the board without touching anything else', async () => {
		await movePad('a', null);
		expect(puts).toEqual([{ id: 'a', pad: null }]);
	});
});
