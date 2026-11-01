import { describe, expect, it } from 'vitest';
import { catalogue, kindOf, tierPrice } from './catalogue';

// docs/SPEC.md "Wardrobe" read off the client's own helpers — the server's
// table holds the same numbers (wardrobe_test.go).
describe('the wardrobe catalogue', () => {
	it('is the one SPEC describes', () => {
		const buy = catalogue.items.filter((i) => kindOf(i) === 'buy');
		expect(catalogue.slots).toHaveLength(39);
		expect(buy).toHaveLength(122);
		expect(catalogue.items.filter((i) => kindOf(i) === 'earn')).toHaveLength(
			33,
		);
		expect(buy.reduce((sum, i) => sum + (tierPrice(i) ?? 0), 0)).toBe(29_860);
	});
});
