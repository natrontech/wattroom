/**
 * Racing yourself on a road (#3033, ADR-0068): the ghost is one of your own
 * earlier rides of it, as a metre for every second (GET /api/routes/{id}/ghost),
 * and the live split is how far ahead or behind it you are right now.
 */

/**
 * When the ghost reached `m` metres, in seconds from its start — between its
 * samples, so a split does not jump a second at a time. Null when it never
 * got that far.
 */
export function ghostSecondsTo(metres: number[], m: number): number | null {
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
	const ghost = ghostSecondsTo(metres, m);
	return ghost === null ? null : seconds - ghost;
}

/** "−0:12" ahead, "+0:08" behind, as the split reads on the riding surface; level is "0:00", unsigned. */
export function formatSplit(split: number): string {
	const s = Math.round(Math.abs(split));
	const sign = s === 0 ? '' : split < 0 ? '−' : '+';
	return `${sign}${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
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
		: {
				value: `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`,
				unit: side,
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
