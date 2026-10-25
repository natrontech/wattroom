import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import FlatRoad from './FlatRoad.svelte';
import { REASONS } from './ride-view';

describe('the Flat-road line', () => {
	it('is REASONS’ line atop slot 1 at label size, never a word’s (G4)', () => {
		const { body } = render(FlatRoad, {
			props: { reason: 'chosen', onretry: () => {} },
		});
		const line = body.match(/<p[^>]*data-testid="flat-road"[^>]*>/)?.[0] ?? '';
		expect(line).toContain('text-label');
		expect(line).not.toContain('text-2xl');
		expect(body).toContain(REASONS.chosen.line);
	});
});
