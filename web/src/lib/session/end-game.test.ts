import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GameState } from '$lib/protocol';

const asked = vi.hoisted(() => ({
	requests: [] as { title: string; action: string; cancel?: string }[],
	answer: true,
}));
vi.mock('$lib/confirm.svelte', () => ({
	confirm: (request: { title: string; action: string; cancel?: string }) => {
		asked.requests.push(request);
		return Promise.resolve(asked.answer);
	},
}));

import { endGame } from './end-game';

const lava = (phase: string, riders = ['a', 'b', 'c']) =>
	({
		mode: 'floor-is-lava',
		phase,
		riders: Object.fromEntries(riders.map((id) => [id, {}])),
	}) as unknown as GameState;

function channel(game: GameState | undefined) {
	const sent: string[] = [];
	return { game, control: (kind: string) => void sent.push(kind), sent };
}

describe('endGame (#2604)', () => {
	beforeEach(() => {
		asked.requests.length = 0;
		asked.answer = true;
	});

	it('asks before ending a running game for everyone in it', async () => {
		const ch = channel(lava('running'));
		await endGame(ch);
		expect(asked.requests).toHaveLength(1);
		expect(asked.requests[0].title).toBe('End Floor is Lava for 3 riders?');
		expect(asked.requests[0].cancel).toBe('Keep riding');
		expect(ch.sent).toEqual(['game-end']);
	});

	it('keeps playing when the rider says so', async () => {
		asked.answer = false;
		const ch = channel(lava('running'));
		await endGame(ch);
		expect(ch.sent).toEqual([]);
	});

	it('clears a finished game’s podium without asking', async () => {
		const ch = channel(lava('done'));
		await endGame(ch);
		expect(asked.requests).toHaveLength(0);
		expect(ch.sent).toEqual(['game-end']);
	});

	it('does nothing with no game', async () => {
		const ch = channel(undefined);
		await endGame(ch);
		expect(asked.requests).toHaveLength(0);
		expect(ch.sent).toEqual([]);
	});
});
