import { createRawSnippet } from 'svelte';
import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import RidingSurface from './RidingSurface.svelte';

const snip = (html: string) => createRawSnippet(() => ({ render: () => html }));
const surface = (props: Record<string, unknown> = {}) =>
	render(RidingSurface, {
		props: {
			header: snip('<p>slot one</p>'),
			focus: snip('<span></span>'),
			world: snip('<canvas></canvas>'),
			...props,
		},
	}).body;

// TARGETS ride-session-road 3 (#3668): the seat clear, the now-playing line
// under it — what no still shows while nothing is queued.
describe('the jukebox seat over the world', () => {
	it('offers a session the seat, nothing drawn in it, and puts the now-playing line under it', () => {
		const html = surface({ seat: snip('<p>Midnight City · Kim</p>') });
		const seat = html.match(/<div data-seat="jukebox"[^>]*><\/div>/);
		expect(seat, 'an empty hole for the player').not.toBeNull();
		// Its own box, at the seat's right edge and width (24 % of the canvas).
		const line = html.match(/<div data-testid="now-playing"[^>]*>/)?.[0] ?? '';
		expect(line).toContain('right:16px');
		expect(line).toContain('width:24%');
		expect(html.indexOf('Midnight City')).toBeGreaterThan(
			html.indexOf('data-testid="now-playing"'),
		);
	});

	it('leaves a solo ride without a seat, and nothing grows into it', () => {
		expect(surface()).not.toContain('data-seat');
	});
});

// #4159: flat, your numbers and the crew share one wrapping row, so neither
// panel spans a wide window with an empty band in it (TARGETS G3).
describe('the flat surface', () => {
	it('sets the numbers and the crew side by side in one row', () => {
		const html = surface({
			world: undefined,
			numbers: snip('<p>129 W</p>'),
			crew: snip('<p>two tiles</p>'),
		});
		const row = html.match(
			/<div class="flex shrink-0 flex-wrap[^"]*">\s*(?:<!--[^>]*-->\s*)*<div data-dock="numbers"[\s\S]*?<div data-dock="crew"/,
		);
		expect(row, 'one row holding both docks').not.toBeNull();
	});
});
