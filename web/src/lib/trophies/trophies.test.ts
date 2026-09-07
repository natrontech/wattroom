import { describe, expect, it } from 'vitest';
import { ACHIEVEMENTS } from './catalogue';
import { RIDER_COUNTS } from './trophies';

describe('RIDER_COUNTS', () => {
	// A count annotates itself with the badge it feeds. Get the key wrong and
	// nothing breaks loudly — the row just quietly never shows a badge again.
	it('only names badges the catalogue has', () => {
		const keys = new Set(ACHIEVEMENTS.map((a) => a.key));
		for (const row of RIDER_COUNTS) {
			if (row.achievement) expect(keys).toContain(row.achievement);
		}
	});

	it('annotates every count the server pays 0 XP for', () => {
		// These four are counted precisely because their XP says nothing, so
		// each one carries the badge that reads it (docs/SPEC.md).
		expect(RIDER_COUNTS.filter((r) => r.achievement).map((r) => r.key)).toEqual(
			['voiceMinutes', 'coached', 'sprintWins', 'tracksPlayed'],
		);
	});
});
