import type { WorkoutStep } from '../types';
import { LIMITS } from '../validate';
import type { ImportOutcome } from './types';

/**
 * The `.erg` course file into the docs/SPEC.md workout JSON (#2327).
 *
 * An .erg is a header and a list of `<minutes> <value>` rows: each pair of
 * consecutive rows is one block, and a pair sharing a timestamp is how the
 * format writes a step change rather than a block of no length. The header's
 * `MINUTES WATTS` / `MINUTES PERCENT` line says which unit the second column
 * is in — the file's own declaration, never guessed from the numbers.
 *
 * Plain text, so there is no parser to attack; every number is checked finite
 * here and every bound comes from `validateWorkout`, which the editor and the
 * server already share.
 */

/** A `.erg` row: an absolute offset in whole seconds, and the column-two value. */
interface Row {
	at: number;
	value: number;
}

interface Header {
	fields: Map<string, string>;
	/** What column two holds, as the file declared it; undefined when it did not. */
	unit?: 'watts' | 'percent';
}

function parseHeader(lines: string[]): Header {
	const header: Header = { fields: new Map() };
	for (const line of lines) {
		const unit = /^MINUTES\s+(WATTS|PERCENT)$/i.exec(line);
		if (unit) {
			header.unit = unit[1].toLowerCase() as 'watts' | 'percent';
			continue;
		}
		const at = line.indexOf('=');
		if (at < 0) continue;
		header.fields.set(
			line.slice(0, at).trim().toUpperCase().replace(/\s+/g, ' '),
			line.slice(at + 1).trim(),
		);
	}
	return header;
}

function parseRows(lines: string[]): Row[] | string {
	const rows: Row[] = [];
	for (const line of lines) {
		const parts = line.split(/\s+/);
		if (parts.length < 2)
			return `That .erg has a course-data line this reader cannot make sense of: “${line.slice(0, 40)}”. Every line holds a time and a value.`;
		const minutes = Number(parts[0]);
		const value = Number(parts[1]);
		if (!Number.isFinite(minutes) || !Number.isFinite(value) || minutes < 0)
			return `That .erg has a course-data line this reader cannot make sense of: “${line.slice(0, 40)}”. Every line holds a time and a value.`;
		rows.push({ at: Math.round(minutes * 60), value });
	}
	return rows;
}

/**
 * Sections are delimited by `[COURSE HEADER]` / `[COURSE DATA]` and their
 * `[END …]` partners. Anything outside a section is ignored, which is what
 * the format's own readers do with trailing junk.
 */
function sections(source: string): { header: string[]; data: string[] } {
	const header: string[] = [];
	const data: string[] = [];
	let into: string[] | null = null;
	for (const raw of source.split(/\r?\n/)) {
		const line = raw.trim();
		if (/^\[COURSE HEADER\]$/i.test(line)) {
			into = header;
			continue;
		}
		if (/^\[COURSE DATA\]$/i.test(line)) {
			into = data;
			continue;
		}
		if (/^\[END /i.test(line)) {
			into = null;
			continue;
		}
		if (into && line !== '') into.push(line);
	}
	return { header, data };
}

/** Three decimals is finer than any trainer resolves, and keeps the JSON readable. */
function fraction(watts: number, ftp: number): number {
	return Math.round((watts / ftp) * 1000) / 1000;
}

/**
 * `riderFtp` converts the file's watts into the fractions a ramp is written
 * in, and is only consulted when the file declares no FTP of its own and
 * actually ramps. A steady block keeps its watts exactly — docs/SPEC.md lets
 * a step carry absolute watts, so nothing is scaled that need not be.
 */
export function parseErg(
	source: string,
	fallbackName: string,
	riderFtp: number | null,
): ImportOutcome {
	const { header: headerLines, data: dataLines } = sections(source);
	if (dataLines.length === 0)
		return {
			ok: false,
			error:
				'That .erg has no [COURSE DATA] section, so there is nothing to ride.',
		};

	const header = parseHeader(headerLines);
	const rows = parseRows(dataLines);
	if (typeof rows === 'string') return { ok: false, error: rows };
	if (rows.length < 2)
		return {
			ok: false,
			error:
				'That .erg has a single course-data point. A block needs a start and an end.',
		};

	const notes: string[] = [];
	const unit = header.unit ?? 'watts';
	if (!header.unit)
		notes.push(
			'The header does not name its units. An .erg holds watts, and the blocks were read that way.',
		);

	const headerFtp = Number(header.fields.get('FTP'));
	const rampFtp =
		Number.isFinite(headerFtp) && headerFtp > 0 ? headerFtp : riderFtp;

	const steps: WorkoutStep[] = [];
	let ramps = 0;
	for (let i = 0; i < rows.length - 1; i++) {
		const seconds = rows[i + 1].at - rows[i].at;
		// Two rows at the same second are how the format writes a step change.
		if (seconds <= 0) continue;
		const from = rows[i].value;
		const to = rows[i + 1].value;
		if (from === to) {
			steps.push(
				unit === 'percent'
					? { type: 'steady', seconds, target: from / 100 }
					: { type: 'steady', seconds, watts: from },
			);
			continue;
		}
		ramps++;
		if (unit === 'percent') {
			steps.push({ type: 'ramp', seconds, from: from / 100, to: to / 100 });
			continue;
		}
		if (!rampFtp || rampFtp <= 0)
			return {
				ok: false,
				error:
					'That .erg ramps between two wattages, and WattRoom ramps in % of FTP. The file states no FTP and neither does your profile — set your FTP in Settings, or add an `FTP = <watts>` line to the file’s header.',
			};
		steps.push({
			type: 'ramp',
			seconds,
			from: fraction(from, rampFtp),
			to: fraction(to, rampFtp),
		});
	}

	if (steps.length === 0)
		return {
			ok: false,
			error: 'Every block in that .erg is zero seconds long.',
		};

	if (ramps > 0 && unit === 'watts' && rampFtp) {
		notes.push(
			Number.isFinite(headerFtp) && headerFtp > 0
				? `The file's ramps are written in watts and WattRoom ramps in % of FTP, so they were converted at the ${headerFtp} W FTP the file states.`
				: `The file's ramps are written in watts and WattRoom ramps in % of FTP, so they were converted at your ${rampFtp} W FTP. Change your FTP later and those ramps move with it; the steady blocks hold their watts.`,
		);
	}
	if (header.fields.get('DESCRIPTION'))
		notes.push(
			'The file’s description was left out — a WattRoom workout has a name and its steps, nothing else.',
		);

	const named = (header.fields.get('FILE NAME') || fallbackName).trim();
	if (named.length > LIMITS.nameLength)
		notes.push(
			`The name was longer than ${LIMITS.nameLength} characters and was cut to fit.`,
		);

	return {
		ok: true,
		imported: {
			workout: {
				name: (named || fallbackName).slice(0, LIMITS.nameLength),
				steps,
			},
			notes,
		},
	};
}
