import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { crewDoorDisclosure } from './crew';
import { liveNumbersLine } from './privacy-copy';
import { FILES, code } from './source-scan.test-helper';

describe('crewDoorDisclosure (#2456)', () => {
	// ADR-0036: a board is on "visibly", before anyone is inside — at the
	// door, because after the button the week is already published.
	it('says a crew with a board keeps one, and what it ranks', () => {
		const said = crewDoorDisclosure({ boardEnabled: true });
		expect(said.board).toMatch(/weekly board/);
		expect(said.board).toMatch(/kJ/);
		expect(said.board).toMatch(/category/);
		expect(said.board).toMatch(/Monday/);
		expect(said.board).toMatch(/take yourself off it/);
		// The board publishes numbers, so the door must not say it does not.
		expect(said.privacy).not.toMatch(/shows nobody your numbers/);
	});

	// A door that warns of a board everywhere teaches riders to skip the line.
	it('says nothing of a board a crew does not keep', () => {
		for (const door of [{ boardEnabled: false }, {}]) {
			const said = crewDoorDisclosure(door);
			expect(said.board).toBeUndefined();
			expect(said.privacy).toMatch(/shows nobody your numbers/);
		}
	});

	it('keeps the standing privacy line either way', () => {
		for (const door of [{ boardEnabled: true }, { boardEnabled: false }]) {
			expect(crewDoorDisclosure(door).privacy).toContain(liveNumbersLine);
		}
	});
});

/**
 * The door is the only way in (#2810). ADR-0036, amended with ADR-0058, puts
 * the word about a crew's board at `/c/[code]` so that nobody is enrolled on
 * it just by joining — and `on_board` defaults to true on that premise. Home's
 * code box used to call the join itself, and a rider who typed a code there
 * was ranked on a board no sentence had mentioned. Any second caller is that
 * bypass again, so it fails here rather than in a rider's week.
 */
describe('joining a crew goes through its door (#2810)', () => {
	const SRC = join(import.meta.dirname, '..');
	const DOOR = 'routes/(app)/c/[code]/+page.svelte';
	// Un-`g`ged on purpose: a global regex carries `lastIndex` from one
	// file's test into the next.
	const JOINS: { call: RegExp; callers: string[] }[] = [
		{ call: /\bjoinCrew\(/, callers: ['lib/crew.ts', DOOR] },
		{ call: /\/api\/crews\/join\b/, callers: ['lib/crew.ts'] },
	];

	it.each(JOINS)('$call is reached only from the door', ({ call, callers }) => {
		const strangers = FILES.filter(
			(file) =>
				!callers.includes(file) &&
				!file.endsWith('.test.ts') &&
				call.test(code(readFileSync(join(SRC, file), 'utf8'))),
		);
		expect(
			strangers,
			`These join a crew without its door, so nothing tells the rider ` +
				`about the crew's weekly board before they are on it:` +
				`\n  ${strangers.join('\n  ')}\n` +
				`Send the rider to crewDoorPath(code) instead.`,
		).toEqual([]);
	});

	it('the door still shows the disclosure it is the only home of', () => {
		expect(FILES, `${DOOR} moved — point this test at it`).toContain(DOOR);
		expect(code(readFileSync(join(SRC, DOOR), 'utf8'))).toMatch(
			/crewDoorDisclosure\(/,
		);
	});
});
