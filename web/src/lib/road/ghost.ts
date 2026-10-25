/**
 * Racing yourself on a road (#3033, ADR-0068): the ghost is one of your own
 * earlier rides of it, as a metre for every second (GET /api/routes/{id}/ghost),
 * and the live split is how far ahead or behind it you are right now.
 */

/**
 * When a line reached `m` metres, in seconds from its start: your ghost's,
 * or your own as this ride draws it (#3246). Between its samples, so a split
 * does not jump a second at a time. Null when it never got that far.
 */
export function secondsTo(metres: number[], m: number): number | null {
	if (metres.length === 0) return null;
	// Short of its first second's metre: the ghost was there from the start.
	if (m <= metres[0]) return 0;
	for (let i = 1; i < metres.length; i++)
		if (metres[i] >= m)
			return i - 1 + (m - metres[i - 1]) / (metres[i] - metres[i - 1] || 1);
	return null;
}

/**
 * The split at your metre `m` after `seconds` of riding: negative when you
 * got here before the ghost did. Null past the ghost's last metre — there is
 * nothing left to race.
 */
export function splitAt(
	metres: number[],
	m: number,
	seconds: number,
): number | null {
	const ghost = secondsTo(metres, m);
	return ghost === null ? null : seconds - ghost;
}

/**
 * The gap since a metre (#3246): what you gained on your ghost (−) or lost
 * (+) between `fromM` and `m`, as the climb card reads it from the climb's
 * foot. `mine` is your own line, a metre each second as the ghost's is. Null
 * short of `fromM`, or past the ghost's last metre.
 */
export function gapSince(
	ghost: number[],
	mine: number[],
	fromM: number,
	m: number,
	seconds: number,
): number | null {
	if (m < fromM) return null;
	const now = splitAt(ghost, m, seconds);
	const you = secondsTo(mine, fromM);
	const it = secondsTo(ghost, fromM);
	return now === null || you === null || it === null ? null : now - (you - it);
}

/**
 * When a whole-road ghost reached the road's end. Its samples keep where
 * each second began, so a ride saved on arrival has none at the end: its
 * last second ended there.
 */
export function finishedIn(metres: number[], lengthM: number): number {
	return secondsTo(metres, lengthM) ?? metres.length;
}

/** Whole seconds as a clock: "1:15". */
const clock = (s: number) =>
	`${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

/** "−0:12" ahead, "+0:08" behind, as the split reads on the riding surface; level is "0:00", unsigned. */
export function formatSplit(split: number): string {
	const s = Math.round(Math.abs(split));
	const sign = s === 0 ? '' : split < 0 ? '−' : '+';
	return `${sign}${clock(s)}`;
}

/**
 * The split in words (#3246): "12 s ahead", "8 s behind", "1:15 behind" from
 * a minute, "level" between. A rider three metres away reads a word faster
 * than a sign, and a colour alone fails WCAG 1.4.1.
 */
export function gapWords(split: number): { value: string; unit: string } {
	const s = Math.round(Math.abs(split));
	if (s === 0) return { value: 'level', unit: '' };
	const side = split < 0 ? 'ahead' : 'behind';
	return s < 60
		? { value: `${s}`, unit: `s ${side}` }
		: { value: clock(s), unit: side };
}

/** "12 s", "1:15": a gap on screen. */
function shortGap(s: number): string {
	return s < 60 ? `${s} s` : clock(s);
}

/** "12 seconds", "1 minute 15 seconds": a gap as the narrator says it. */
function spokenGap(s: number): string {
	const count = (n: number, word: string) =>
		`${n} ${word}${n === 1 ? '' : 's'}`;
	const min = Math.floor(s / 60);
	const sec = s % 60;
	if (min === 0) return count(sec, 'second');
	return sec === 0
		? count(min, 'minute')
		: `${count(min, 'minute')} ${count(sec, 'second')}`;
}

/** "Your best · 12 s ahead": the gap as the climb card and the strip read it (#3246). */
export function gapLine(split: number, best: boolean): string {
	const { value, unit } = gapWords(split);
	return `${best ? 'Your best' : 'Your last'} · ${unit ? `${value} ${unit}` : value}`;
}

const LAST_CALL_M = 500;

/**
 * Where the gap is called on a road (#3246, docs/spec/roads.md): a quarter,
 * halfway and three quarters along, and 500 m from the end. A road under
 * 2 km drops the last, which would come before three quarters.
 */
export function callMarks(lengthM: number): { m: number; name: string }[] {
	const marks = [
		{ m: lengthM * 0.25, name: 'A quarter in' },
		{ m: lengthM * 0.5, name: 'Halfway' },
		{ m: lengthM * 0.75, name: 'Three quarters in' },
	];
	const last = lengthM - LAST_CALL_M;
	return last > marks[2].m
		? [...marks, { m: last, name: '500 m to go' }]
		: marks;
}

/** The mark a second crossed, riding from `fromM` to `toM`; null with none. */
export function crossedMark(
	marks: { m: number; name: string }[],
	fromM: number,
	toM: number,
): { m: number; name: string } | null {
	return marks.findLast((k) => fromM < k.m && k.m <= toM) ?? null;
}

/** "Halfway, 12 seconds ahead of your best": the narrator's call (#3246). */
export function callSaid(name: string, split: number, best: boolean): string {
	const s = Math.round(Math.abs(split));
	const whom = best ? 'your best' : 'your last ride';
	if (s === 0) return `${name}, level with ${whom}`;
	return `${name}, ${spokenGap(s)} ${split < 0 ? 'ahead of' : 'behind'} ${whom}`;
}

/**
 * A new best on a road (#3246): whole seconds faster than your best's end,
 * on screen and as the narrator says it. Null short of a whole second.
 */
export function newBestOn(
	road: string,
	split: number,
): { faster: string; line: string; said: string } | null {
	const s = Math.round(-split);
	if (s < 1) return null;
	return {
		faster: `${shortGap(s)} faster`,
		line: `New best on ${road}, ${shortGap(s)} faster`,
		said: `New best on ${road}, ${spokenGap(s)} faster`,
	};
}

/**
 * Where the ghost was `seconds` into its ride, between its samples. Null
 * once it has finished: a ghost leaves at its stretch's end (#3245).
 */
export function ghostMetreAt(metres: number[], seconds: number): number | null {
	if (seconds < 0 || seconds > metres.length - 1) return null;
	const i = Math.floor(seconds);
	const next = metres[Math.min(i + 1, metres.length - 1)];
	return metres[i] + (next - metres[i]) * (seconds - i);
}

/** "Tuesday-you, 12 Aug": the ride your ghost is, by its weekday and date (#3615). */
export function ghostLabel(startedAt: Date): string {
	const day = startedAt.toLocaleDateString(undefined, { weekday: 'long' });
	const date = startedAt.toLocaleDateString(undefined, {
		day: 'numeric',
		month: 'short',
	});
	return `${day}-you, ${date}`;
}
