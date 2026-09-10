// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The library warms its pads through the audio bus, which wants an
// AudioContext this environment has not got. Nothing here is about sound.
vi.mock('$lib/sound/board.svelte', () => ({ prefetch: () => {} }));

const { board, movePad, nameFromFile } =
	await import('$lib/board/clips.svelte');

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
