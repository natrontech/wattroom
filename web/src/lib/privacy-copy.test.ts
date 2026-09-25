import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FILES, code } from './source-scan.test-helper';

/**
 * The places a rider reads before deciding to ride with people (#2824). Each
 * once said live numbers stay inside a session, and a free ride (ADR-0059)
 * made that false while every one of them went on saying it.
 */
describe('who sees live numbers is said once', () => {
	const SRC = join(import.meta.dirname, '..');
	const SURFACES = [
		'lib/crew.ts',
		'lib/profile/YourData.svelte',
		'routes/dev/account/+page.svelte',
		'routes/(legal)/privacy/+page.svelte',
	];

	it.each(SURFACES)('%s says it with liveNumbersLine', (file) => {
		expect(FILES, `${file} moved — point this test at it`).toContain(file);
		expect(code(readFileSync(join(SRC, file), 'utf8'))).toMatch(
			/\bliveNumbersLine\b/,
		);
	});

	// The old promise, in the words it was written in.
	const STALE = [
		/visible only inside a session/i,
		/visible to the session you ride in/i,
		/only inside the session you ride in/i,
		/live metrics are\s+session-scoped/i,
		/stay\s+inside the session you ride in/i,
		// The rider page's "Never" aside, which the list above missed.
		/stay\s+inside the session, as always/i,
		/session-scoped, as today/i,
	];

	it('no page still promises the session-only rule', () => {
		const stale = FILES.filter((file) => {
			if (file.endsWith('.test.ts')) return false;
			const source = code(readFileSync(join(SRC, file), 'utf8'));
			return STALE.some((line) => line.test(source));
		});
		expect(
			stale,
			`These still say live numbers stay inside a session, which a free ride ` +
				`made untrue (ADR-0059). Use liveNumbersLine from $lib/privacy-copy:` +
				`\n  ${stale.join('\n  ')}`,
		).toEqual([]);
	});
});
