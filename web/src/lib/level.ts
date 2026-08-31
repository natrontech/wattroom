/**
 * Level math (#253) — docs/SPEC.md: level n requires 500 × n^1.6 cumulative
 * XP. A fresh rider is level 0; the first 500 XP is the first ring.
 */

/** Cumulative XP required to hold level n. */
export function xpForLevel(n: number): number {
	return Math.round(500 * Math.pow(n, 1.6));
}

/** Highest level the given lifetime XP holds. */
export function levelFromXp(xp: number): number {
	if (xp < 500) return 0;
	let n = Math.floor(Math.pow(xp / 500, 1 / 1.6));
	// Round-trip float edges: settle on the exact threshold neighbours.
	while (xpForLevel(n + 1) <= xp) n++;
	while (n > 0 && xpForLevel(n) > xp) n--;
	return n;
}

/** 0..1 progress from the current level's threshold to the next. */
export function levelProgress(xp: number): number {
	const level = levelFromXp(xp);
	const current = xpForLevel(level);
	const next = xpForLevel(level + 1);
	return Math.min(1, Math.max(0, (xp - current) / (next - current)));
}
