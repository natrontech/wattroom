import type { SprintState } from '$lib/protocol';
import { serverNow } from '$lib/room/server-clock';
import type { Segment } from './types';

/** How far ahead a sprint block is counted in on screen: docs/SPEC.md's klaxon lead. */
export const SPRINT_LEAD_SECONDS = 3;

/** What the window is computed from — the session reads it out on every sync. */
export interface SprintClock {
	segments: Segment[];
	segment: Segment | undefined;
	index: number;
	/** The workout second. */
	clock: number;
	done: boolean;
	/** The ride is over: no window. */
	over: boolean;
}

/**
 * The sprint window as the room's SprintMoment reads it (#1793): the
 * sprint block under way, or the one starting within SPRINT_LEAD_SECONDS
 * so the screen counts it in, in the server clock's ms the moment reads.
 * Computed once per block rather than every tick, so "left" runs down
 * smoothly instead of being re-anchored on every second. #1529 flipped the
 * trainer to slope for a solo sprint and left the screen reading "no
 * target — spin easy" for the whole window.
 */
export function createSprintWindow(read: () => SprintClock) {
	let window = $state<SprintState | null>(null);
	let key: number | null = null;
	return {
		/** The sprint block on screen, or the one about to be — null otherwise. */
		get current() {
			return window;
		},
		sync() {
			const { segments, segment, index, clock, done, over } = read();
			let next: number | null = null;
			let startsIn = 0;
			let seconds = 0;
			const following = segments[index + 1];
			if (over) {
				next = null;
			} else if (segment?.kind === 'sprint' && !done) {
				next = index;
				startsIn = segment.startSeconds - clock;
				seconds = segment.seconds;
			} else if (
				following?.kind === 'sprint' &&
				following.startSeconds - clock <= SPRINT_LEAD_SECONDS
			) {
				next = index + 1;
				startsIn = following.startSeconds - clock;
				seconds = following.seconds;
			}
			if (next === key) return;
			key = next;
			if (next === null) {
				window = null;
				return;
			}
			const startsAtMs = serverNow() + startsIn * 1000;
			window = { startsAtMs, endsAtMs: startsAtMs + seconds * 1000 };
		},
	};
}
