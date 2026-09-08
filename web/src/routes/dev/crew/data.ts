/**
 * MOCK data for /dev/crew (#1023). One shape, drawn three ways — the options
 * are only comparable if they are fed identical rooms.
 *
 * Chosen to break a naive tree rather than flatter it: three crews, one of
 * them four rooms deep, one room mid-session, one in voice, one empty, one
 * private the viewer may see but not enter, and one crew whose rooms the
 * viewer administers without being in them (ADR-0038).
 */
export type Access =
	/** Open to the crew — ADR-0038's default for rooms created after the cutover. */
	| 'open'
	/** Private: crew role plus named exceptions. The viewer is in. */
	| 'private'
	/** Private, and the viewer is not. Visible because they are crew, not enterable. */
	| 'locked'
	/** Crew-admin sight only: listed, permissions manageable, contents not readable. */
	| 'admin';

export type MockRoom = {
	slug: string;
	name: string;
	icon: string;
	members: number;
	connected?: number;
	unread?: number;
	session?: { workoutName: string; elapsedSec: number };
	voice?: string[];
	next?: string;
	access: Access;
};

export type MockCrew = {
	slug: string;
	name: string;
	icon: string;
	/**
	 * Viewer's crew role — what inherits into every room below (ADR-0038).
	 * `owner` is the un-removable one added by the 2026-09-08 amendment: it
	 * cannot be demoted, removed or banned, and always reaches the crew's and
	 * its rooms' permissions. It is deliberately NOT a reading power.
	 */
	role: 'owner' | 'admin' | 'member';
	rooms: MockRoom[];
};

export const crews: MockCrew[] = [
	{
		slug: 'natron',
		name: 'Natron',
		icon: 'zap',
		role: 'owner',
		rooms: [
			{
				slug: 'thursday',
				name: 'Thursday Threshold',
				icon: 'flame',
				members: 9,
				connected: 4,
				session: { workoutName: 'Sweet Spot 3×12', elapsedSec: 740 },
				access: 'open',
			},
			{
				slug: 'lounge',
				name: 'The Lounge',
				icon: 'coffee',
				members: 9,
				connected: 3,
				voice: ['Sven', 'David', 'Lena'],
				access: 'open',
			},
			{
				slug: 'sprint-club',
				name: 'Sprint Club',
				icon: 'rocket',
				members: 6,
				access: 'open',
			},
			{
				slug: 'coaches',
				name: 'Coaches',
				icon: 'trophy',
				members: 3,
				access: 'locked',
			},
		],
	},
	{
		slug: 'sunday-long',
		name: 'Sunday Long',
		icon: 'mountain',
		role: 'member',
		rooms: [
			{
				slug: 'sunday',
				name: 'Sunday Sufferfest',
				icon: 'sun',
				members: 14,
				unread: 12,
				next: 'Endurance 90 · Sun 09:00',
				access: 'open',
			},
			{
				slug: 'recovery',
				name: 'Recovery Spin',
				icon: 'moon',
				members: 11,
				access: 'open',
			},
		],
	},
	{
		slug: 'winter-club',
		name: 'Winter Club',
		icon: 'snowflake',
		role: 'admin',
		rooms: [
			{
				slug: 'winter-a',
				name: 'A Group',
				icon: 'bike',
				members: 22,
				connected: 2,
				access: 'admin',
			},
			{
				slug: 'winter-b',
				name: 'B Group',
				icon: 'bike',
				members: 18,
				access: 'admin',
			},
		],
	},
];

/** The room the viewer is standing in, opened into its places. */
export const openRoom = 'thursday';

/** Live things a crew holds, summed — what a collapsed crew still has to say. */
export function crewPulse(crew: MockCrew): {
	riding: number;
	voice: number;
	unread: number;
} {
	return crew.rooms.reduce(
		(a, r) => ({
			riding: a.riding + (r.session ? (r.connected ?? 0) : 0),
			voice: a.voice + (r.voice?.length ?? 0),
			unread: a.unread + (r.unread ?? 0),
		}),
		{ riding: 0, voice: 0, unread: 0 },
	);
}
