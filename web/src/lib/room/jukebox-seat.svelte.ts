/**
 * Where the room's one player sits (#316).
 *
 * The iframe can never be reparented — moving it in the DOM reloads it and the
 * playback everyone is synced to dies with it — so the dock's shell stays
 * `fixed` and is flown over whichever seat is on screen. A surface offers the
 * box it wants covered; the dock measures that box every frame and follows it.
 *
 * Three seats, one rider choice, remembered per device: the jukebox panel
 * (default — the room's music surface), the room itself (big, above the cams,
 * for watching something together), and floating (the dock, free on the frame).
 * A box too small for the RMF floor is no seat at all: a narrow window falls
 * back to floating rather than squeezing the player under 200×200.
 */

export type Seat = 'panel' | 'room' | 'float';
/** The seats a surface can offer — 'float' is the absence of one. */
export type SeatName = Exclude<Seat, 'float'>;

const SEATS: Seat[] = ['panel', 'room', 'float'];
const KEY = 'wattroom.jukebox.seat';

/** YouTube RMF floor (WATTROOM.md): below this the player may not be shown. */
export const MIN_SEAT = 200;

export const seating = $state({
	/** Where the rider wants the picture. */
	want: 'panel' as Seat,
	/** Where it actually is — a seat can be absent or too small to take. */
	at: 'float' as Seat,
});

/**
 * The boxes on offer. Deliberately NOT reactive: claiming reads the list it
 * then pushes to, and inside an attachment that is a self-invalidating effect
 * — the dock polls this instead, which is what it does with their geometry
 * anyway.
 */
export const claims: Record<SeatName, HTMLElement[]> = { panel: [], room: [] };

/**
 * Read the remembered choice once the DOM exists. Not at module load: this
 * module is imported during SSR too, where there is no localStorage and no
 * rider whose desk it is.
 */
export function hydrateSeat(): void {
	try {
		const saved = localStorage.getItem(KEY);
		if (saved && SEATS.includes(saved as Seat)) seating.want = saved as Seat;
	} catch {
		// desk-only preference; a blocked store costs one click
	}
}

export function setSeat(next: Seat): void {
	seating.want = next;
	try {
		localStorage.setItem(KEY, next);
	} catch {
		// as above
	}
}

/** Offer a box for the player. Returns the release, for the attachment. */
export function claimSeat(name: SeatName, node: HTMLElement): () => void {
	const offered = claims[name];
	offered.push(node);
	return () => {
		const at = offered.indexOf(node);
		if (at >= 0) offered.splice(at, 1);
	};
}

export function fits(rect: { width: number; height: number }): boolean {
	return rect.width >= MIN_SEAT && rect.height >= MIN_SEAT;
}

/**
 * The box the player should cover, or null to float. The newest claim wins,
 * and a claim that does not fit is skipped: below xl the panel is in the DOM
 * twice — the hidden column and the summoned sheet — and only the one on
 * screen measures at all.
 */
export function seatNode(
	measure: (node: HTMLElement) => { width: number; height: number },
): HTMLElement | null {
	if (seating.want === 'float') return null;
	const offered = claims[seating.want];
	for (let i = offered.length - 1; i >= 0; i--)
		if (fits(measure(offered[i]))) return offered[i];
	return null;
}
