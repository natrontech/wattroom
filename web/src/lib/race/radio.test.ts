import { describe, expect, it } from 'vitest';
import type { RaceReadout } from './race-view';
import { createRadio, PHRASES, RADIO_SPACING_S } from './radio';

const race = (over: Partial<RaceReadout> = {}): RaceReadout => ({
	at: 0,
	phase: 'racing',
	par: 0,
	category: 'C',
	place: 2,
	of: 4,
	toLine: 6000,
	...over,
});

describe('the team-car radio (#3174)', () => {
	it('never speaks twice inside 20 s, however much happens', () => {
		const radio = createRadio();
		const said: number[] = [];
		// Ten minutes at 4 Hz, the place and the par changing every second.
		for (let k = 0; k <= 2400; k++) {
			const t = k / 4;
			const call = radio.hear(
				race({
					place: 1 + (Math.floor(t) % 3),
					par: Math.sin(t) * 30,
					toLine: 6000 - t * 9,
				}),
				t,
			);
			if (call) said.push(t);
		}
		// #3174's number, not the constant's: at most one call per 20 s.
		expect(RADIO_SPACING_S).toBe(20);
		expect(said.length).toBeGreaterThan(20);
		for (let i = 1; i < said.length; i++)
			expect(said[i] - said[i - 1]).toBeGreaterThanOrEqual(RADIO_SPACING_S);
	});

	it('says the most pressing call first, and drops what a new phase makes stale', () => {
		const radio = createRadio();
		expect(radio.hear(race({ phase: 'neutral', par: null }), 0)?.text).toBe(
			PHRASES.neutral(),
		);
		// The klaxon and a par call wait out the spacing; the klaxon goes first.
		radio.hear(race({ par: 18 }), 5);
		expect(radio.hear(race({ par: 18 }), 20)?.text).toBe(PHRASES.klaxon());
		expect(radio.hear(race({ par: 18 }), 40)?.text).toBe('0:18 up on par.');
		// Held, then back on before the radio may speak: only "back on" is said.
		radio.hear(race({ phase: 'held', par: 18 }), 45);
		radio.hear(race({ par: 18 }), 50);
		expect(radio.hear(race({ par: 18 }), 60)?.text).toBe(PHRASES.resumed());
	});

	it('speaks only its closed phrases', () => {
		const radio = createRadio();
		const known = new Set<string>();
		const texts: string[] = [];
		for (let k = 0; k <= 4000; k++) {
			const t = k / 4;
			const phase =
				t < 30
					? 'neutral'
					: t > 900
						? 'finished'
						: t % 300 < 20
							? 'held'
							: 'racing';
			const call = radio.hear(
				race({
					phase,
					par: phase === 'neutral' ? null : Math.round(Math.cos(t / 40) * 50),
					place: 1 + (Math.floor(t / 60) % 4),
					toLine: Math.max(0, 9000 - t * 10),
				}),
				t,
			);
			if (call) texts.push(call.text);
		}
		for (const p of [
			PHRASES.neutral(),
			PHRASES.klaxon(),
			PHRASES.held(),
			PHRASES.resumed(),
		])
			known.add(p);
		const templates = [
			/^(\d+:\d\d) (up|down) on par\.$|^On par\.$/,
			/^\d+(st|nd|rd|th) of \d+ in [A-D]\.$/,
			/^\d+ k?m to the line\.$/,
			/^Over the line\. \d+(st|nd|rd|th) in [A-D]\.$/,
		];
		for (const text of texts)
			expect(
				known.has(text) || templates.some((re) => re.test(text)),
				text,
			).toBe(true);
		expect(texts).toContain(
			PHRASES.finish(1 + (Math.floor(900.25 / 60) % 4), 'C'),
		);
	});
});
