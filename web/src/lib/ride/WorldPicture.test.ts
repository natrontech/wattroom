import { afterEach, describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import { worldPicture } from '$lib/world/picture.svelte';
import WorldPicture from './WorldPicture.svelte';

const card = () => render(WorldPicture).body;
const jpeg = () => new Blob(['jpeg']);

describe('the closing card’s World pictures (#4263, #4431)', () => {
	afterEach(() => worldPicture.clear());

	it('holds their place with “Drawing…” while the world draws them', () => {
		void worldPicture.draw(new Promise(() => {}));
		expect(card()).toContain('Drawing…');
		expect(card()).not.toContain('data-testid="world-picture"');
	});

	it('offers both pictures once they are drawn', async () => {
		await worldPicture.draw(Promise.resolve({ rider: jpeg(), above: jpeg() }));
		expect(card()).toContain('data-testid="world-picture"');
		expect(card()).toContain('data-testid="world-picture-above"');
		expect(card()).not.toContain('Drawing…');
	});

	it('offers the one the browser gave, where it gave only one', async () => {
		await worldPicture.draw(Promise.resolve({ rider: jpeg(), above: null }));
		expect(card()).toContain('data-testid="world-picture"');
		expect(card()).not.toContain('data-testid="world-picture-above"');
	});

	it('is absent where the world drew none', () => {
		expect(card()).not.toContain('button');
	});
});
