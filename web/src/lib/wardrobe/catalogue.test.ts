import { readFileSync } from 'node:fs';
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

// docs/spec/garage.md names the eight skin swatches; the catalogue and the
// --world-skin-n tokens must carry the same ones (#3413).
describe('the skin swatches', () => {
	it('are the ones SPEC names, in the catalogue and in app.css', () => {
		const spec = readFileSync('../docs/spec/garage.md', 'utf8');
		const css = readFileSync('src/app.css', 'utf8');
		const specHexes = spec
			.split('\n')
			.find((l) => l.startsWith('- **Skin**'))!
			.match(/#[0-9a-f]{6}/g)!
			.slice(0, 8);
		expect(specHexes).toHaveLength(8);
		expect(catalogue.skinTones.map((s) => s.hex)).toEqual(specHexes);
		specHexes.forEach((hex, i) =>
			expect(css).toContain(`--world-skin-${i + 1}: ${hex};`),
		);
	});
});
