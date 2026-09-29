import { describe, expect, it } from 'vitest';
import { SHOWN_WINDOWS } from './progression';

// The server keeps 3- and 12-minute bests for the critical-power model
// (#3261) and sends them beside the four; they are never a PR a rider is
// shown, and every surface draws its windows from this one list.
describe('the curve windows a rider is shown', () => {
	it("are docs/SPEC.md's four and never the critical-power pair", () => {
		const keys: string[] = SHOWN_WINDOWS.map((w) => w.key);
		expect(keys).toEqual(['best5s', 'best1m', 'best5m', 'best20m']);
		expect(keys).not.toContain('best3m');
		expect(keys).not.toContain('best12m');
	});
});
