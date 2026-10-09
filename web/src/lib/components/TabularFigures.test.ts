import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import TabularFigures from './TabularFigures.svelte';
import ComputerHead from '$lib/session/ComputerHead.svelte';
import Instrument from '$lib/session/Instrument.svelte';

const cells = (html: string) =>
	[...html.matchAll(/<span data-figure="(\d)" class="([^"]*)"/g)].map(
		([, figure, classes]) => ({ figure, classes }),
	);

describe('tabular figures (TARGETS G4, #3869)', () => {
	it('draws every figure in a cell of one width', () => {
		const drawn = cells(
			render(TabularFigures, { props: { value: 1098 } }).body,
		);
		expect(drawn.map((c) => c.figure).join('')).toBe('1098');
		expect(new Set(drawn.map((c) => c.classes)).size).toBe(1);
		expect(drawn[0].classes).toMatch(/\bw-\[0\.62em\]/);
	});

	it('keeps the value one text for a screen reader, the drawn figures hidden', () => {
		const html = render(TabularFigures, { props: { value: 1098 } }).body;
		expect(html).toMatch(/<span class="sr-only">1098<\/span>/);
		expect(html).toMatch(/<span aria-hidden="true">/);
	});

	it('draws what is not a figure as it is', () => {
		const html = render(TabularFigures, { props: { value: '—' } }).body;
		expect(cells(html)).toHaveLength(0);
		expect(html).toMatch(/<span aria-hidden="true">(<!--[^>]*-->)*—/);
	});

	// Chakra Petch has no tnum, so `tabular-nums` alone left these
	// proportional: 1098 drew 24 px wider than 1100 at 104 px.
	it.each([
		[
			'the computer head',
			() =>
				render(ComputerHead, {
					props: { power: 1098, kg: 75, ftp: 250, stale: false },
				}).body,
		],
		[
			'the flat instrument',
			() =>
				render(Instrument, { props: { watts: 1098, target: 0, ftp: 250 } })
					.body,
		],
	])('%s sets the 3 s power in tabular figures', (_, draw) => {
		expect(
			cells(draw())
				.map((c) => c.figure)
				.join(''),
		).toBe('1098');
	});
});
