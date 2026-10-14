import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import ComputerHead from './ComputerHead.svelte';
import Instrument from './Instrument.svelte';

/** #3215: what the plan asks is neon and flat; watt and its glow are the live 3 s power (ADR-0005). */
const asked = (html: string) =>
	[
		...html.matchAll(/<[^>]*data-testid="gauge-(?:target|slot)"[^>]*>/g),
		...html.matchAll(/<span class="text-neon">\d+<\/span>/g),
	].map((m) => m[0]);

const head = () =>
	render(ComputerHead, {
		props: { power: 240, kg: 75, ftp: 250, stale: false, target: 250 },
	}).body;
const instrument = () =>
	render(Instrument, {
		props: { watts: 240, target: 250, ftp: 250, fullScale: 375 },
	}).body;

describe('a prescribed target wears neon, never watt, never a glow', () => {
	it.each([
		['the computer head', head],
		['the instrument', instrument],
	])('%s', (_, draw) => {
		const marks = asked(draw());
		expect(marks.length).toBeGreaterThan(0);
		for (const m of marks) expect(m).not.toMatch(/watt|glow/);
	});
});
