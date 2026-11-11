import { untrack } from 'svelte';
import { rideRoom } from '$lib/channel/ride-room.svelte';
import type { ViewState } from '$lib/protocol';
import { computerShown } from '$lib/session/computer-shown.svelte';
import { worldPicture } from '$lib/world/picture.svelte';
import { viewSwitch } from '$lib/world/ride-view';

/**
 * What the riding screen's own controls offer the phone remote now (the
 * shared ride controls, ride-controls.ts): the view switch's segments, the
 * ⚑, TV mode and End ride. Each control offers its action while it is drawn
 * and live, and the phone holds the same control while none does, so the
 * phone can do what the now bar does and nothing it does not.
 *
 * The latest offer of an action runs it. TV mode's own frame offers `tv` as
 * its way out `over` the button that opened it, which may offer again while
 * TV mode is up.
 */
export const OFFERED = [
	'view-3d',
	'view-flat',
	'view-map',
	'view-room',
	'flag',
	'tv',
	'end',
] as const;
export type Offered = (typeof OFFERED)[number];

type Entry = { action: Offered; run: () => void; over: boolean };

export function createRideOffers() {
	// Raw: an entry is compared by identity when it is withdrawn.
	let entries = $state.raw<Entry[]>([]);
	let flags = $state(0);
	let tv = $state(false);
	return {
		/**
		 * Offers `action` until the returned function is called. Untracked,
		 * so an effect that offers does not rerun on its own offer. An offer
		 * `over` the others runs in their place whenever they were made.
		 */
		offer(action: Offered, run: () => void, over = false): () => void {
			const entry: Entry = { action, run, over };
			untrack(() => (entries = [...entries, entry]));
			return () =>
				untrack(() => (entries = entries.filter((e) => e !== entry)));
		},
		/**
		 * Runs the latest offer of `action`, one made `over` the others
		 * first; says whether there was one.
		 */
		run(action: string): boolean {
			const entry =
				entries.findLast((e) => e.action === action && e.over) ??
				entries.findLast((e) => e.action === action);
			if (!entry) return false;
			entry.run();
			return true;
		},
		/** The offered actions, each once, in OFFERED's order. */
		get list(): Offered[] {
			return OFFERED.filter((a) => entries.some((e) => e.action === a));
		},
		/** Flags marked on this screen, so the phone can say its Flag took. */
		get flags() {
			return flags;
		},
		flagged() {
			flags += 1;
		},
		/** TV mode is up on this screen. */
		get tv() {
			return tv;
		},
		set tv(on: boolean) {
			tv = on;
		},
		reset() {
			entries = [];
			flags = 0;
			tv = false;
		},
	};
}

/** This screen's offers: one riding screen per tab. */
export const rideOffers = createRideOffers();

/**
 * What the riding screen says to the phone about its view and its bar
 * (#4223, #4253): where its rider looks, as the view switch's pressed
 * segment, its camera and pictures, its flags, TV mode, and what its own
 * controls offer.
 */
export function viewNow(): ViewState {
	const look = viewSwitch({
		world: computerShown.world,
		reason: null,
		onMap: computerShown.page === 'map',
		inRoom: rideRoom.on && rideRoom.offered,
	}).pressed;
	return {
		look,
		world: computerShown.world,
		camera: computerShown.world ? (computerShown.camera ?? '') : '',
		pictures: worldPicture.taken,
		flags: rideOffers.flags,
		tv: rideOffers.tv,
		offers: rideOffers.list,
	};
}

/**
 * The remote runner's handlers for every offered action, each run through
 * the riding screen's own control.
 */
export function offeredActions(): Record<Offered, () => void> {
	return Object.fromEntries(
		OFFERED.map((a) => [a, () => void rideOffers.run(a)]),
	) as Record<Offered, () => void>;
}
