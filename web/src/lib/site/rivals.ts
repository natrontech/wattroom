/**
 * The comparisons' facts (#2995). Every line here is a claim about someone
 * else's product, so every line has a source, and the whole set carries the
 * date it was checked (seo.ts CHECKED). Google's review guidance asks for
 * exactly this — first-hand, quantitative, pros and cons, alternatives named
 * — and a comparison that flatters us by being wrong about them is the
 * fastest way to lose the reader it was written for.
 *
 * Two things riders assume that are false, and must stay out of this file:
 * Zwift DOES scale a group workout to each rider's FTP, and TrainerRoad DOES
 * have group workouts with voice. WattRoom's difference is elsewhere.
 */

export type Source = { label: string; url: string };

export type Rival = {
	slug: string;
	name: string;
	url: string;
	/** What it costs, as the vendor states it. */
	price: string;
	runsOn: string;
	/** How a few friends ride one structured workout together. */
	together: string;
	voice: string;
	world: string;
	openSource: string;
	/** One paragraph: what it is, fairly. */
	summary: string;
	/** Reasons a rider should pick it over WattRoom. */
	pickThem: string[];
	/** Reasons a rider should pick WattRoom over it. */
	pickUs: string[];
	sources: Source[];
};

/** WattRoom's own row, said the way the rivals' are. */
export const OURS = {
	name: 'WattRoom',
	price: 'Free',
	runsOn:
		'Chrome or Edge on Windows, macOS and Android, or the desktop app. No trainer control on iPhone or iPad',
	together:
		'Anyone in the voice channel starts any workout; every trainer holds its own rider’s FTP',
	voice: 'Voice and camera built in, one tap',
	world: 'None: tiles, numbers and the interval chart',
	openSource: 'Yes (AGPL), and self-hostable',
} as const;

export const RIVALS: readonly Rival[] = [
	{
		slug: 'zwift',
		name: 'Zwift',
		url: 'https://www.zwift.com/',
		price: 'US$19.99 a month or US$199.99 a year',
		runsOn: 'Windows, macOS, iOS, Android and Apple TV apps',
		together:
			'Group workouts scale to each rider’s FTP; a private one goes through a Meetup, and club events offer preset workouts',
		voice: 'Text chat; crews bring Discord for voice',
		world: 'A 3D world with routes, drafting and racing',
		openSource: 'No',
		summary:
			'Zwift is the biggest indoor-cycling world: routes to ride, races around the clock, and a game around every workout. Its group workouts already put each rider on their own FTP. What it does not have is a place for your crew to talk: chat is typed, and the riders who want to hear each other run Discord beside it.',
		pickThem: [
			'You want to race: Zwift’s event calendar and racing scene have no equal.',
			'You like riding somewhere: routes, climbs and a world to look at.',
			'You train on an Apple TV, an iPad or an iPhone.',
		],
		pickUs: [
			'Your crew wants to talk while it rides, without a second app.',
			'Any workout, started by anyone in the channel, without setting up a Meetup first.',
			'Games decided by watts alone: no drafting, no power-ups, no avatars.',
			'It costs nothing, runs in a browser tab, and the code is open.',
		],
		sources: [
			{
				label: 'Zwift’s 2024 price change (DC Rainmaker)',
				url: 'https://www.dcrainmaker.com/2024/05/increases-prices-hardware.html',
			},
			{
				label: 'Group workouts and each rider’s FTP (Zwift Forums)',
				url: 'https://forums.zwift.com/t/group-workouts-different-watt-kgs/546458',
			},
			{
				label: 'Group workouts through a Meetup (Zwift Insider)',
				url: 'https://zwiftinsider.com/zwift-meetup-group-workouts/',
			},
			{
				label: 'The standing request for voice chat (Zwift Forums)',
				url: 'https://forums.zwift.com/t/voice-chat-option/651000',
			},
			{
				label: 'Using Discord alongside Zwift (Zwift Insider)',
				url: 'https://zwiftinsider.com/using-discord/',
			},
		],
	},
	{
		slug: 'trainerroad',
		name: 'TrainerRoad',
		url: 'https://www.trainerroad.com/',
		price: 'US$21.99 a month or US$209.99 a year, for every rider',
		runsOn:
			'Windows, macOS, iOS and Android apps; group workouts on Windows and macOS',
		together:
			'Group workouts for up to 11 riders, each on their own FTP, with voice and video',
		voice: 'Voice and video in group workouts',
		world: 'None: a workout chart',
		openSource: 'No',
		summary:
			'TrainerRoad is a training plan first: adaptive plans that change with how your rides go, and deep analysis afterwards. Its group workouts are the closest thing to WattRoom there is — up to eleven riders, each on their own FTP, talking and seeing each other. Every rider needs a subscription, and group workouts run on the desktop apps.',
		pickThem: [
			'You want a coach in the app: adaptive training plans and analysis are what TrainerRoad is built for.',
			'You follow a plan more than you ride with friends.',
		],
		pickUs: [
			'Nobody in your crew has to pay to ride with you.',
			'The crew is a place that stays: text channels, voice channels, a schedule, a board, between rides as well as during them.',
			'Game modes, a shared jukebox and a soundboard when a straight workout is not the point.',
			'It runs in a browser tab on a laptop or an Android phone, and the code is open.',
		],
		sources: [
			{
				label: 'Introducing group workouts (TrainerRoad)',
				url: 'https://www.trainerroad.com/blog/introducing-group-workouts/',
			},
			{
				label: 'Pricing (TrainerRoad)',
				url: 'https://www.trainerroad.com/pricing',
			},
		],
	},
	{
		slug: 'mywhoosh',
		name: 'MyWhoosh',
		url: 'https://www.mywhoosh.com/',
		price: 'Free',
		runsOn: 'Windows, macOS, iOS and Android apps',
		together: 'Group rides and pacer-led group workouts in its virtual world',
		voice: 'Text chat',
		world: 'A 3D world with routes, races and prize events',
		openSource: 'No',
		summary:
			'MyWhoosh is the free virtual world: routes, races and events with prize money, and a workout library, at no cost. It is the answer when the question is “Zwift, but free”. It is a world to ride in with other people rather than a place for your own crew to meet and talk.',
		pickThem: [
			'You want a free 3D world with routes and races.',
			'You want prize events and a large public field to ride against.',
			'You train on an iPhone or iPad.',
		],
		pickUs: [
			'Your crew wants its own space: text and voice channels, a schedule, a board.',
			'You want to hear each other ride, not type at each other.',
			'Any workout, together, each trainer on its rider’s own FTP, started by anyone in the channel.',
			'The code is open, and a club can run its own server.',
		],
		sources: [{ label: 'MyWhoosh', url: 'https://www.mywhoosh.com/' }],
	},
];

export function rival(slug: string): Rival | undefined {
	return RIVALS.find((r) => r.slug === slug);
}
