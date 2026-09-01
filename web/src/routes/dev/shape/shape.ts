/**
 * ADR-0020's shape, made clickable. One frame renders every route: rooms+you |
 * places | content | people+talk, with column 2 resolving against context —
 * the room's places when you stand in one, yours when you don't.
 *
 * Fake data, real tokens, real components. The point of the mock is the column
 * budget and the signals, not the pixels: if a screen does not survive ~700 px
 * of content column, the shape is wrong and this is where that shows.
 */

/** Which chrome a screen wants around it. */
export type Context =
	| 'room' // columns 1+2(room places)+3+4
	| 'you' // columns 1+2(your places)+3 — no people column outside a room
	| 'bare'; // its own frame: TV, the phone spectator, login

export interface Screen {
	id: string;
	label: string;
	group: string;
	context: Context;
	/** Which DM head lights up, when the screen is a conversation. */
	peer?: string;
	/** Which column-2 entry lights up. */
	place?: string;
	/** The ride is the cave (ADR-0005 amended); the lounge is a desk surface. */
	caved?: boolean;
	/** One line on what this screen is proving. */
	note: string;
}

export const SCREENS: Screen[] = [
	{
		id: 'room-lounge',
		label: 'Lounge',
		group: 'In a room',
		context: 'room',
		place: 'lounge',
		note: 'The default place. Tiles are the room; the stage appears only when someone shares.',
	},
	{
		id: 'room-focus',
		label: 'Lounge · focused',
		group: 'In a room',
		context: 'room',
		place: 'lounge',
		note: 'What "video-first" used to be: a focused rider, not a layout mode.',
	},
	{
		id: 'room-stage',
		label: 'Lounge · shared screen',
		group: 'In a room',
		context: 'room',
		place: 'lounge',
		note: 'What "media-focus" used to be. RMF: nothing overlays the player.',
	},
	{
		id: 'room-countdown',
		label: 'Countdown',
		group: 'In a room',
		context: 'room',
		place: 'training',
		caved: true,
		note: 'Lights go down 10 s before the shared timeline starts.',
	},
	{
		id: 'room-training',
		label: 'Training · running',
		group: 'In a room',
		context: 'room',
		place: 'training',
		caved: true,
		note: 'The 3 m surface. Chrome may be Discord-dense; this cannot be.',
	},
	{
		id: 'room-sessions',
		label: 'Sessions',
		group: 'In a room',
		context: 'room',
		place: 'sessions',
		note: 'A place with a URL, not a card wedged under the tiles.',
	},
	{
		id: 'room-members',
		label: 'Members',
		group: 'In a room',
		context: 'room',
		place: 'members',
		note: 'Roles, medals, who is here — the full read of column 4.',
	},
	{
		id: 'room-settings',
		label: 'Room settings',
		group: 'In a room',
		context: 'room',
		place: 'settings',
		note: 'Was /r/[slug]/settings, a page you navigated away to.',
	},
	{
		id: 'room-picker',
		label: 'Session picker',
		group: 'In a room',
		context: 'room',
		place: 'training',
		note: 'Still a modal: picking a workout is a decision, not a destination.',
	},
	{
		id: 'room-summary',
		label: 'Session summary',
		group: 'In a room',
		context: 'room',
		place: 'training',
		note: 'The room telling you it is over — modal on purpose (#359).',
	},

	{
		id: 'home',
		label: 'Home',
		group: 'Your places',
		context: 'you',
		place: 'home',
		note: 'The between-rides surface, now inside the same furniture.',
	},
	{
		id: 'rooms',
		label: 'Rooms',
		group: 'Your places',
		context: 'you',
		place: 'rooms',
		note: 'Managing rooms, not standing in one. Column 1 is the switcher.',
	},
	{
		id: 'sessions',
		label: 'Sessions',
		group: 'Your places',
		context: 'you',
		place: 'sessions',
		note: 'Same place as the room one, with no room selected.',
	},
	{
		id: 'workouts',
		label: 'Workouts',
		group: 'Your places',
		context: 'you',
		place: 'workouts',
		note: 'Library plus curated shelf at ~700 px.',
	},
	{
		id: 'editor',
		label: 'Workout editor',
		group: 'Your places',
		context: 'you',
		place: 'workouts',
		note: 'The tightest screen in the app — three panes inside one column.',
	},
	{
		id: 'history',
		label: 'Rides',
		group: 'Your places',
		context: 'you',
		place: 'history',
		note: 'The ride log survives the narrower column unchanged.',
	},
	{
		id: 'progression',
		label: 'Progression',
		group: 'Your places',
		context: 'you',
		place: 'progression',
		note: 'Charts are the other thing 700 px has to prove.',
	},
	{
		id: 'profile',
		label: 'Profile',
		group: 'Your places',
		context: 'you',
		place: 'profile',
		note: 'Where the mixer, gate and theme move out of column 1 to.',
	},
	{
		id: 'pair',
		label: 'Sensors',
		group: 'Your places',
		context: 'you',
		place: 'pair',
		note: 'Capability gating with a reason, unchanged.',
	},
	{
		id: 'ramp',
		label: 'Ramp test',
		group: 'Your places',
		context: 'you',
		place: 'ramp',
		caved: true,
		note: 'Solo, but still a ride — so still the cave.',
	},
	{
		id: 'ride',
		label: 'Solo ride',
		group: 'Your places',
		context: 'you',
		place: 'workouts',
		caved: true,
		note: 'The room shape with nobody else in it.',
	},
	{
		id: 'whats-new',
		label: "What's new",
		group: 'Your places',
		context: 'you',
		place: 'home',
		note: 'The changelog the running build shipped with.',
	},

	{
		id: 'friends',
		label: 'Friends',
		group: 'Messages',
		context: 'you',
		place: 'friends',
		note: 'Was a section at the bottom of /home, under your week\u2019s numbers.',
	},
	{
		id: 'dm',
		label: 'A conversation',
		group: 'Messages',
		context: 'you',
		place: 'dm',
		peer: 'Nina',
		note: 'Was a 320\u00d7384 drawer pinned bottom-right, dodging the jukebox dock.',
	},

	{
		id: 'tv',
		label: 'TV mode',
		group: 'Its own frame',
		context: 'bare',
		caved: true,
		note: 'The one alternate render that survives — a viewing distance, not a preference.',
	},
	{
		id: 'watch',
		label: 'Phone spectator',
		group: 'Its own frame',
		context: 'bare',
		note: 'Deliberately not this shell — read-only, any mobile browser.',
	},
	{
		id: 'mobile',
		label: 'Phone · the room',
		group: 'Its own frame',
		context: 'bare',
		note: 'Columns 1+2 collapse into a drawer; column 3 is the screen.',
	},
	{
		id: 'login',
		label: 'Login',
		group: 'Its own frame',
		context: 'bare',
		caved: true,
		note: 'No frame to be in yet.',
	},
];

export const GROUPS = [...new Set(SCREENS.map((s) => s.group))];

/** Column 2 inside a room. */
export const ROOM_PLACES = [
	{ id: 'lounge', label: 'Lounge', hint: 'talk, tiles, the stage' },
	{ id: 'training', label: 'Training', hint: 'the session and your numbers' },
	{ id: 'sessions', label: 'Sessions', hint: "what's planned here" },
	{ id: 'members', label: 'Members', hint: 'roles and medals' },
	{ id: 'settings', label: 'Settings', hint: 'name, sounds, reactions' },
];

/** Column 2 outside a room — what TopNav used to be, vertical and permanent. */
export const YOUR_PLACES = [
	{ id: 'home', label: 'Home', hint: '' },
	{ id: 'rooms', label: 'Rooms', hint: '' },
	{ id: 'sessions', label: 'Sessions', hint: '' },
	{ id: 'workouts', label: 'Workouts', hint: '' },
	{ id: 'history', label: 'Rides', hint: '' },
	{ id: 'progression', label: 'Progression', hint: '' },
	{ id: 'ramp', label: 'Ramp test', hint: '' },
	{ id: 'pair', label: 'Sensors', hint: '' },
	{ id: 'profile', label: 'Profile', hint: '' },
];

/**
 * Column 1's whole argument (#181, gap 4): a room you are NOT looking at has to
 * say something, or the app has no reason to stay open in a background window.
 */
export interface RailRoom {
	slug: string;
	name: string;
	icon: string;
	members: number;
	connected: number;
	riders: string[];
	voice: string[];
	/** A session is running right now, and how far in. */
	session?: { workoutName: string; elapsedSec: number };
	/** Planned, not started. */
	next?: { workoutName: string; when: string };
	unread?: number;
	mention?: boolean;
}

export const RAIL_ROOMS: RailRoom[] = [
	{
		slug: 'thursday-sufferfest',
		name: 'Thursday Sufferfest',
		icon: '🔥',
		members: 6,
		connected: 6,
		riders: ['Nina', 'Ruben', 'Milo', 'Sara', 'Tobi', 'You'],
		voice: ['Nina', 'Ruben', 'Sara', 'You'],
		session: { workoutName: 'Sweet Spot 2×20', elapsedSec: 740 },
	},
	{
		slug: 'mfw-5',
		name: 'mfw-5',
		icon: '🚴',
		members: 9,
		connected: 3,
		riders: ['Jonas', 'Lea', 'Pat'],
		voice: ['Jonas', 'Lea'],
		unread: 12,
		mention: true,
	},
	{
		slug: 'sunday-long-ride',
		name: 'Sunday Long Ride',
		icon: '🌄',
		members: 4,
		connected: 0,
		riders: [],
		voice: [],
		next: { workoutName: 'Endurance 90', when: 'Sun 09:00' },
		unread: 3,
	},
	{
		slug: 'natron-lunch-crew',
		name: 'Natron Lunch Crew',
		icon: '🥪',
		members: 5,
		connected: 0,
		riders: [],
		voice: [],
	},
	{
		slug: 'winter-base-camp',
		name: 'Winter Base Camp',
		icon: '❄️',
		members: 11,
		connected: 0,
		riders: [],
		voice: [],
	},
];

export const DM_HEADS = [
	{ name: 'Nina', unread: true },
	{ name: 'Ruben', unread: false },
	{ name: 'Jonas', unread: false },
];
