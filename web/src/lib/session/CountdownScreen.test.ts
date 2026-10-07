import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import CountdownScreen from './CountdownScreen.svelte';

// G2: the count-in is a count to the start, not a measured reading, so its
// digit is neither watt nor glowing — in the full layout and the compact one.
describe.each([false, true])('the count-in digit (compact: %s)', (compact) => {
	const body = render(CountdownScreen, {
		props: { remaining: 3, title: 'Openers', compact },
	}).body;
	const digit = body.match(/<(?:p|span)[^>]*aria-hidden="true"[^>]*>/)?.[0];

	it('is drawn, hidden from the screen reader', () => {
		expect(digit).toBeDefined();
	});

	it('is not watt and does not glow', () => {
		expect(digit).not.toMatch(/watt/);
		expect(digit).not.toMatch(/glow/);
	});
});
