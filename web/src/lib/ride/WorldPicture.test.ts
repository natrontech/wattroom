import { afterEach, describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import { worldPicture } from '$lib/world/picture.svelte';
import WorldPicture from './WorldPicture.svelte';

const card = () => render(WorldPicture).body;

describe('the closing card’s World picture (#4263)', () => {
	afterEach(() => worldPicture.clear());

	it('holds its place with “Drawing…” while the world draws it', () => {
		void worldPicture.draw(new Promise(() => {}));
		expect(card()).toContain('Drawing…');
		expect(card()).not.toContain('data-testid="world-picture"');
	});

	it('offers the picture once it is drawn', async () => {
		await worldPicture.draw(Promise.resolve(new Blob(['jpeg'])));
		expect(card()).toContain('World picture');
		expect(card()).not.toContain('Drawing…');
	});

	it('is absent where the world drew none', () => {
		expect(card()).not.toContain('button');
	});
});
