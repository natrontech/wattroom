import { formatDuration } from '$lib/format';
import type { SessionRecap, SessionRecapRider } from '$lib/protocol';

/**
 * One rider's bar on a session recap card (ADR-0034), as a percentage of the
 * session's own clock — so "Kim came in a third of the way through" reads
 * without reading a number.
 *
 * Geometry lives here rather than in the component because it is the only part
 * of the card that can be wrong: a bar that starts in the wrong place tells a
 * rider something untrue about who was there.
 */
export interface RecapBar {
	id: string;
	rider: string;
	/** They have a ride for this session — a filled pip. */
	rode: boolean;
	/** Percent from the session's start, 0–100. */
	left: number;
	/** Percent of the session's length, always at least visible. */
	width: number;
	/** "49 min" — how long they were here, not how long the session was. */
	stayed: string;
}

/** The narrowest bar still worth drawing: a two-minute visit is not nothing. */
const MIN_WIDTH = 2;

/**
 * How long someone stayed. `formatDuration` rounds to whole minutes, which
 * writes "0 min" beside a bar that is visibly there — so anything under a
 * minute says so instead of saying nothing happened.
 */
function stayed(ms: number): string {
	return ms < 60_000 ? '< 1 min' : formatDuration(ms / 1000);
}

export function recapBars(recap: SessionRecap): RecapBar[] {
	const span = Math.max(1, recap.endedAt - recap.startedAt);
	return recap.riders.map((rider: SessionRecapRider) => {
		// Clamped to the session: a rider present before the timeline started
		// belongs at its left edge, not off the card.
		const from = Math.min(Math.max(rider.from, recap.startedAt), recap.endedAt);
		const to = Math.min(Math.max(rider.to, from), recap.endedAt);
		const left = ((from - recap.startedAt) / span) * 100;
		return {
			id: rider.id,
			rider: rider.rider,
			rode: rider.rode,
			left,
			// Never wider than what is left of the track, so a bar cannot
			// overflow its row.
			width: Math.min(
				100 - left,
				Math.max(MIN_WIDTH, ((to - from) / span) * 100),
			),
			stayed: stayed(to - from),
		};
	});
}

/**
 * The one line the collapsed card shows — how many were here and how long it
 * ran. Everything else waits until a rider opens it.
 */
export function recapSummary(recap: SessionRecap): string {
	const riders = recap.riders.length;
	const long = stayed(recap.endedAt - recap.startedAt);
	return `${riders} ${riders === 1 ? 'rider' : 'riders'} · ${long}`;
}
