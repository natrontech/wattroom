/**
 * ADR-0008's see-and-stop line (#62), as words (#2804). Heart rate reaches
 * the call whenever something reports it, and a strap bonded to the trainer
 * in another app reports it with no pairing step here — so whether it is
 * going out has to be on the riding screen, not in the rider's memory.
 */
export type HrSource = 'heart-rate' | 'trainer';

export interface HrShareView {
	shared: boolean;
	/** Where it comes from, and who sees it. */
	text: string;
	/** The button, naming the act. */
	action: string;
	/** What pressing it sets `shareHr` to. */
	next: boolean;
}

/**
 * Null draws nothing: with no heart rate coming in there is nothing to
 * share, and while another of the rider's screens holds the trainer the hub
 * takes that screen's samples, not these (#610) — a toggle here would change
 * nothing (ux.md).
 */
export function hrShareView(
	source: HrSource | null,
	shared: boolean,
	driving: boolean,
): HrShareView | null {
	if (!source || !driving) return null;
	const from = source === 'trainer' ? 'your trainer' : 'your strap';
	return shared
		? {
				shared,
				text: `Heart rate from ${from} · shared with the call`,
				action: 'Stop sharing',
				next: false,
			}
		: {
				shared,
				text: `Heart rate from ${from} · not shared`,
				action: 'Share',
				next: true,
			};
}
