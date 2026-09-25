import { describe, expect, it } from 'vitest';
import { scan } from './source-scan.test-helper';

/**
 * Zone colours mark; they never write (#2856). The ramp is fitted to a fill's
 * floor — Z1 recedes at 1.9:1 on purpose (ADR-0023 §3) — and words and
 * numerals are held to 4.5:1, large numerals included, because the rider is
 * three metres away. Painting a zone's name or a crewmate's watts in its zone
 * colour put "z1 Active recovery" at 2.1:1 under the big number. A zone is now
 * a ZoneDot beside text drawn in text colours, and nothing may look a text
 * class up by zone again: the lookup that made it easy is gone.
 */
describe('zone colours on text', () => {
	it('no file paints text by zone', () => {
		const { offenders } = scan(/\bZONE_TEXT\b|text-z\$\{/g, {
			'lib/zone-text.test.ts': 'this guard',
		});
		expect(
			offenders,
			'mark the zone with ZoneDot and draw the words in text-ink or text-muted',
		).toEqual([]);
	});
});
