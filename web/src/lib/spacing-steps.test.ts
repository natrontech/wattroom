import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { code, FILES } from './source-scan.test-helper';

/**
 * The spacing scale holds (#613): padding, margin and gap take whole steps
 * from 0 to 8. A half-step (`p-2.5`) or a step past 8 (`mt-12`) is how one
 * panel came to be drawn eighteen ways. Today's are counted per file in
 * spacing-steps.ratchet.json, so nothing anyone sees changes here: a file may
 * lose them and never gain one. Moving today's onto the scale is a visual
 * change, and the design owner's call.
 */
const RATCHET: Record<string, number> = JSON.parse(
	readFileSync(join(import.meta.dirname, 'spacing-steps.ratchet.json'), 'utf8'),
);

/** `p-4`, `sm:-mt-0.5`, `gap-x-2.5` — not `top-12`, `step-10` or `p-[3vh]`. */
const STEP =
	/(?<![\w\-[.])(?:[a-z0-9-]+:)*-?(?:[pm][xytblrse]?|gap(?:-[xy])?)-(\d+(?:\.\d+)?)(?![\w.\-\]%])/g;

const SRC = join(import.meta.dirname, '..');

/** Off-scale steps per file: a fraction, or past 8. */
function offScale(): Record<string, number> {
	const counts: Record<string, number> = {};
	for (const file of FILES) {
		if (file.endsWith('.test.ts')) continue;
		for (const m of code(readFileSync(join(SRC, file), 'utf8')).matchAll(
			STEP,
		)) {
			const step = Number(m[1]);
			if (!Number.isInteger(step) || step > 8)
				counts[file] = (counts[file] ?? 0) + 1;
		}
	}
	return counts;
}

describe('the spacing scale (#613)', () => {
	const now = offScale();

	it('gains no half-step and no step past 8', () => {
		const grown = Object.entries(now)
			.filter(([file, n]) => n > (RATCHET[file] ?? 0))
			.map(([file, n]) => `  ${file}: ${n}, allowed ${RATCHET[file] ?? 0}`);
		expect(
			grown,
			`Off the spacing scale:\n${grown.join('\n')}\n` +
				'Padding, margin and gap take a whole step from 0 to 8 (p-2, mt-6, ' +
				'gap-3). An arbitrary value (p-[3vh]) is for a size the scale cannot ' +
				'say, and says so.',
		).toEqual([]);
	});

	it('lowers the ratchet as the count goes down', () => {
		const slack = Object.entries(RATCHET)
			.filter(([file, n]) => (now[file] ?? 0) < n)
			.map(([file, n]) => `  ${file}: ${now[file] ?? 0}, ratchet says ${n}`);
		expect(
			slack,
			`Lower these in spacing-steps.ratchet.json (delete a 0):\n${slack.join('\n')}`,
		).toEqual([]);
	});
});
