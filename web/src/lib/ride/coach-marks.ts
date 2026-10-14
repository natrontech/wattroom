/**
 * The three marks a rider's first world ride shows (#3218), once per device:
 * dismissed or finished, they stay away until "How to read the road" asks
 * for them. A browser that keeps nothing shows them each ride, never throws.
 */
const KEY = 'wattroom.coach.road.v1';

// Labels, not sentences: a riding surface carries no teaching copy (TARGETS G4).
export const COACH_MARKS = [
	'Your zone: the ring under you',
	'The road ahead',
	'CLIMB opens by itself',
] as const;

export function coachSeen(): boolean {
	try {
		return localStorage.getItem(KEY) !== null;
	} catch {
		return false;
	}
}

export function coachDone(): void {
	try {
		localStorage.setItem(KEY, '1');
	} catch {
		// Nothing kept: the marks show again next ride.
	}
}
