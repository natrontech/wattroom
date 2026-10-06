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

/** Ten minutes at 4 Hz that would keep any radio talking: holds, the line coming up fast, place and par moving. */
function busyRace(t: number): RaceReadout {
	return race({
		phase:
			t < 15
				? 'neutral'
				: t > 560
					? 'finished'
					: t % 47 < 6
						? 'held'
						: 'racing',
		toLine: Math.max(0, 12_000 - t * 25),
		place: 1 + (Math.floor(t) % 3),
		par: Math.round(Math.sin(t) * 40),
	});
}

function listen() {
	const radio = createRadio();
	const said: { t: number; text: string }[] = [];
	for (let k = 0; k <= 2400; k++) {
		const t = k / 4;
		const call = radio.hear(busyRace(t), t);
		if (call) said.push({ t, text: call.text });
	}
	return said;
}

describe('the team-car radio (#3174)', () => {
	it('never speaks twice inside 20 s, however much happens', () => {
		// #3174's number, not the constant's: at most one call per 20 s.
		expect(RADIO_SPACING_S).toBe(20);
		const said = listen();
		expect(said.length).toBeGreaterThan(10);
		for (let i = 1; i < said.length; i++)
			expect(said[i].t - said[i - 1].t).toBeGreaterThanOrEqual(RADIO_SPACING_S);
	});

	it('says the most pressing call first, and drops what a new phase makes stale', () => {
		const radio = createRadio();
		expect(
			radio.hear(race({ phase: 'neutral', par: null, toLine: 6000 }), 0)?.text,
		).toBe(PHRASES.neutral());
		// The klaxon and a kilometre mark wait out the spacing; the klaxon goes first.
		radio.hear(race({ toLine: 6000 }), 5);
		radio.hear(race({ toLine: 4990 }), 6);
		expect(radio.hear(race({ toLine: 4900 }), 20)?.text).toBe(PHRASES.klaxon());
		expect(radio.hear(race({ toLine: 4800 }), 40)?.text).toBe(
			'5 km to the line.',
		);
		// Held, then back on before the radio may speak: only "back on" is said.
		radio.hear(race({ phase: 'held', toLine: 4700 }), 45);
		radio.hear(race({ toLine: 4700 }), 50);
		expect(radio.hear(race({ toLine: 4600 }), 60)?.text).toBe(
			PHRASES.resumed(),
		);
	});

	it('speaks only its closed phrases, and never a number the RACE page shows', () => {
		const said = listen().map((s) => s.text);
		const fixed = new Set([
			PHRASES.neutral(),
			PHRASES.klaxon(),
			PHRASES.held(),
			PHRASES.resumed(),
			PHRASES.finish(),
			// SPEC "Races": the marks the radio counts down, and no others.
			'10 km to the line.',
			'5 km to the line.',
			'2 km to the line.',
			'1 km to the line.',
			'500 m to the line.',
		]);
		for (const text of said) {
			expect(fixed.has(text), text).toBe(true);
			// One home per number: the place and the gap to par are the page's.
			expect(text).not.toMatch(/\d+(st|nd|rd|th)\b|par/);
		}
		expect(said).toContain(PHRASES.finish());
	});
});
