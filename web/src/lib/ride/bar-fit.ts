/**
 * Which of the ride's controls the now bar shows, and which go under More
 * (docs/spec/riding.md, "The ride's controls and the phone remote"). The bar
 * is one row that never scrolls: End ride, the trim and the Road | Watts
 * switch always show; the rest give way in a fixed order as the row narrows,
 * and what gave way is one press away in the More menu.
 */

/** Never under More: ending the ride, the every-minute trim, what you set. */
export const KEPT: ReadonlySet<string> = new Set([
	'end',
	'trim',
	'mode',
	'cancel',
]);

/** The order of giving way, first to go first. */
export const GIVE_WAY: readonly string[] = [
	'workout',
	'session',
	'repeats',
	'pacer',
	'ride-with',
	'tv',
	'photo',
	'camera',
	'flag',
	'change',
	'extend',
	'pause',
	'resume',
	'skip',
	'view',
	// A session's coach: the sprint, pause and hand-off, after everything else.
	'coach',
];

export interface BarControl {
	/** Unique in the row: two "Ride with" buttons are two controls. */
	key: string;
	/** What it is (`data-ride-control`); unnamed controls give way before the view switch. */
	id: string;
	width: number;
}

/** A control nobody named goes after every named one but the view switch and the coach's. */
function rank(id: string): number {
	const at = GIVE_WAY.indexOf(id);
	return at < 0 ? GIVE_WAY.indexOf('view') - 0.5 : at;
}

/**
 * Fits `controls`, in row order, into `available` px with `gap` between
 * them. Everything fits: no More. Otherwise controls go under More by
 * `GIVE_WAY` (of two alike, the later one first) until the rest and a
 * `more` px More button fit. The kept ones show whatever the width.
 */
export function fitControls(
	available: number,
	controls: BarControl[],
	{ gap = 6, more = 44 }: { gap?: number; more?: number } = {},
): { shown: string[]; more: string[] } {
	const span = (list: BarControl[], extra = 0) =>
		list.reduce((sum, c) => sum + c.width, extra) +
		gap * Math.max(0, list.length - 1 + (extra ? 1 : 0));
	let shown = controls;
	if (span(shown) > available) {
		const leaving = controls
			.map((control, at) => ({ control, at }))
			.filter(({ control }) => !KEPT.has(control.id))
			.sort((a, b) => rank(a.control.id) - rank(b.control.id) || b.at - a.at);
		const gone = new Set<string>();
		for (const { control } of leaving) {
			gone.add(control.key);
			shown = controls.filter((c) => !gone.has(c.key));
			if (span(shown, more) <= available) break;
		}
	}
	const keys = new Set(shown.map((c) => c.key));
	return {
		shown: [...keys],
		more: controls.filter((c) => !keys.has(c.key)).map((c) => c.key),
	};
}
