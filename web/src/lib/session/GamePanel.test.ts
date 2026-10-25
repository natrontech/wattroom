import { describe, expect, it } from 'vitest';
import { createRawSnippet } from 'svelte';
import { render } from 'svelte/server';
import GamePanel from '$lib/session/GamePanel.svelte';
import type { GameState } from '$lib/protocol';

/** The panel as the eliminated rider's screen draws it, deck and all. */
function panel(game: Partial<GameState>, me = 'me') {
	return render(GamePanel, {
		props: {
			game: { riders: {}, ...game } as GameState,
			roster: [{ id: 'sven', name: 'Sven' }],
			end: () => {},
			canControl: false,
			me,
			roadside: createRawSnippet(() => ({
				render: () => '<span data-deck>deck</span>',
			})),
		},
	}).body;
}

// #3022: a rider a game puts out is told where that leaves them — at the
// roadside, still riding, with the deck in reach.
describe('the eliminated rider (#3022)', () => {
	it.each([
		['backyard-ramp', { eliminated: true }],
		['floor-is-lava', { eliminated: true, lives: 0 }],
	])('is at the roadside in %s, with the deck', (mode, row) => {
		const body = panel({
			mode,
			phase: 'running',
			riders: { me: row, sven: {} },
		});
		expect(body).toContain('at the roadside now');
		expect(body).toContain('data-deck');
	});

	it('says nothing of the roadside to a rider still in the game', () => {
		const body = panel({
			mode: 'backyard-ramp',
			phase: 'running',
			riders: { me: {}, sven: { eliminated: true } },
		});
		expect(body).not.toContain('roadside');
		expect(body).not.toContain('data-deck');
	});

	it('lets the roadside go when the game ends', () => {
		const body = panel({
			mode: 'backyard-ramp',
			phase: 'done',
			riders: { me: { eliminated: true } },
		});
		expect(body).not.toContain('roadside');
	});
});

// #4162: inside the ride's focus dock, itself a ride-panel, the game draws no
// card of its own (TARGETS G3, panels never nested).
describe('the game in the ride focus (#4162)', () => {
	const game = { mode: 'points-race', phase: 'running' } as GameState;
	const props = { game, roster: [], end: () => {}, canControl: true };

	it('draws its own card where it stands alone', () => {
		expect(render(GamePanel, { props }).body).toContain('border-2');
	});

	it('draws no card inside a panel', () => {
		const body = render(GamePanel, { props: { ...props, flat: true } }).body;
		expect(body).not.toMatch(/border-2|bg-surface-raised|rounded-lg/);
		expect(body).toContain('End game');
	});
});
