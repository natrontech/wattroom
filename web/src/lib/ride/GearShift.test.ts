import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// ADR-0005: --color-watt marks live data and is the only thing that glows. A
// gear is rider state (#3330): neon, and never the watt accent.
describe('the gear field', () => {
	const source = readFileSync(
		new URL('./GearShift.svelte', import.meta.url),
		'utf8',
	);

	it('is neon, never the watt accent, and never glows', () => {
		expect(source).toMatch(/\btext-neon\b/);
		expect(source).not.toMatch(/--color-watt|\b[a-z]+-watt\b/);
		expect(source).not.toMatch(/\bglow\b|drop-shadow|text-shadow/);
	});
});
