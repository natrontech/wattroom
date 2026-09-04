/**
 * How a tile says what a person is doing. One vocabulary for the Lounge tile
 * and the sidebar strip (#505): the strip is the same marks at a smaller
 * size, never a second visual language for the same rider.
 *
 * Class names are literal, like the zone ramp's — Tailwind scans source text
 * and would never generate a name assembled at runtime.
 */

/**
 * The tile's frame. Speaking is a ring in the voice colour the roster and the
 * you-panel already speak (z4) — presence is not live data, so it never
 * reaches for `watt` and never glows (ADR-0005). Idle is `--color-edge`,
 * which is a real line on paper and a whisper in the cave.
 */
export function tileFrame(speaking: boolean, away = false): string {
	if (away) return 'ring-edge/50 ring-1 opacity-60';
	return speaking ? 'ring-z4 ring-2' : 'ring-edge ring-1';
}

/**
 * Backing for a mark that has to read over an unknown camera frame as well as
 * over the tile's own surface. Surface rather than paper: paper IS the raised
 * surface in the white family, so a paper chip on a light tile was invisible.
 */
export const MARK_SURFACE = 'bg-surface/85 text-ink';

/** In voice with an open mic — the same dot the roster puts on the avatar. */
export const VOICE_DOT = 'bg-z4 h-1.5 w-1.5 rounded-full';

/** Muted: a struck-through mic, quiet chrome, wherever the rider is drawn. */
export const MUTED_MARK = 'text-muted shrink-0';

/** Explicitly stepped out: quiet structural chrome, never live-data watt. */
export const AWAY_MARK =
	'bg-surface/85 text-muted rounded-full px-1.5 py-0.5 text-[9px] font-medium tracking-wider uppercase';
