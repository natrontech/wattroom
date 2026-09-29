import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createWBal, fitCPW } from './cpw';

/**
 * The critical-power model's golden vectors (#3262), written by the Go twin
 * (`go test ./internal/road -run TestCPWGolden -update`).
 */
const golden = JSON.parse(
	readFileSync(
		new URL(
			'../../../../server/internal/protocol/testdata/cpw-golden.json',
			import.meta.url,
		),
		'utf8',
	),
) as {
	fits: {
		best3m: number;
		best12m: number;
		best5m: number;
		best20m: number;
		ok: boolean;
		cp: number;
		wPrime: number;
		estimate: boolean;
	}[];
	traces: {
		name: string;
		cp: number;
		wPrime: number;
		legs: { seconds: number; watts: number; balance: number }[];
	}[];
};

const within = (got: number, want: number) =>
	Math.abs(got - want) <= 0.001 * Math.max(Math.abs(want), 1);

describe('the critical-power model agrees with its Go twin', () => {
	it('has vectors to agree on', () => {
		expect(golden.fits.length).toBeGreaterThan(0);
		expect(golden.traces.length).toBeGreaterThan(0);
	});

	for (const f of golden.fits)
		it(`fits ${f.best3m}/${f.best12m}/${f.best5m}/${f.best20m} W`, () => {
			const got = fitCPW(f);
			if (!f.ok) {
				expect(got).toBeNull();
				return;
			}
			expect(got).not.toBeNull();
			expect(within(got!.cp, f.cp), `CP ${got!.cp} vs ${f.cp}`).toBe(true);
			expect(within(got!.wPrime, f.wPrime), `W′ ${got!.wPrime}`).toBe(true);
			expect(got!.estimate).toBe(f.estimate);
		});

	for (const tr of golden.traces)
		it(tr.name, () => {
			const w = createWBal({ cp: tr.cp, wPrime: tr.wPrime, estimate: false });
			for (const leg of tr.legs) {
				for (let s = 0; s < leg.seconds; s++) w.step(leg.watts);
				expect(
					within(w.balance, leg.balance),
					`${w.balance} vs ${leg.balance}`,
				).toBe(true);
			}
		});
});

describe('fitCPW', () => {
	it('flags the 5/20 fallback as an estimate', () => {
		const m = fitCPW({ best3m: 0, best12m: 300, best5m: 350, best20m: 280 });
		expect(m?.estimate).toBe(true);
		expect(m?.wPrime).toBeCloseTo(28_000, 6);
		expect(m?.cp).toBeCloseTo(770 / 3, 6);
	});

	it('fits nothing for a rider with no curve', () => {
		expect(fitCPW({ best3m: 0, best12m: 0, best5m: 0, best20m: 0 })).toBeNull();
	});
});
