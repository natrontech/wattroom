import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import RouteShape from './RouteShape.svelte';

describe('a route from above (#3679)', () => {
	it('says why there is no map, in the panel, when the route kept only its heights', () => {
		const { body } = render(RouteShape, {
			props: { note: 'This route kept its heights, not its map.' },
		});
		expect(body).toContain('This route kept its heights, not its map.');
		expect(body).not.toContain('<svg');
		expect(body).not.toContain('Only you see this map');
	});

	it('keeps the panel height with a shape, and says the map is yours alone', () => {
		const { body } = render(RouteShape, {
			props: { x: [0, 100, 200], z: [0, 50, 0], length: 300 },
		});
		expect(body).toContain('h-[220px]');
		expect(body).toContain('Only you see this map');
	});
});
