/**
 * The three marks a rider's first world ride shows (#3218), once per device:
 * dismissed or finished, they stay away until "How to read the road" asks
 * for them. A browser that keeps nothing shows them each ride, never throws.
 */
const KEY = 'wattroom.coach.road.v1';

export const COACH_MARKS = [
	{
		title: 'Your zone',
		body: 'The ring under you is your zone. It changes colour as your power does.',
	},
	{
		title: 'The road ahead',
		body: 'The line ahead is the road. Its slope sets how hard your trainer pushes back.',
	},
	{
		title: 'The climb card',
		body: 'When a climb starts, the bike computer turns to CLIMB by itself.',
	},
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
