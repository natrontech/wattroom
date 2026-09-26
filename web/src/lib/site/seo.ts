/**
 * What the public pages say about themselves to search, link previews and
 * AI crawlers (ADR-0061). They are prerendered at build time, so every build
 * names wattroom.ch — a self-hoster's too: the words are the project's, and a
 * copy on another host should point search back at the original rather than
 * compete with it. The app's own routes get their meta from the server
 * (server/internal/og), which knows the host it runs on.
 */
export const SITE_ORIGIN = 'https://wattroom.ch';
export const SITE_NAME = 'WattRoom';
export const REPO = 'https://github.com/natrontech/wattroom';

/**
 * A page's share card: web/static/cards/<name>.png, shot from /dev/card by
 * `make screenshots` (seo.test.ts fails on a page without one).
 */
export function cardName(page: SitePage): string {
	return page.path === '/' ? 'home' : page.path.slice(1).replaceAll('/', '-');
}

/** A public page, as the sitemap and its own head describe it. */
export type SitePage = {
	path: string;
	title: string;
	description: string;
	/** The page's language, when it is not English (hreflang). */
	lang?: 'de';
};

export const LANDING: SitePage = {
	path: '/',
	title: 'WattRoom — train together, not alone',
	// Google shows about 155 characters. The second sentence is WATTROOM.md's
	// own positioning: "Zwift alternative", "structured workouts" and "smart
	// trainer" are what a rider types into a search box (#2139).
	description:
		'Discord for indoor cycling — no virtual world, your watts are the game. A Zwift alternative for structured workouts and smart-trainer rides with friends.',
};

export const GROUP_WORKOUTS: SitePage = {
	path: '/group-workouts',
	title: 'Group workouts with friends, voice built in — WattRoom',
	description:
		'Ride one structured workout with your friends, every trainer on its own FTP, talking the whole way. Free, in Chrome or Edge, no Meetup workaround.',
};

export const ZWIFT_ALTERNATIVE: SitePage = {
	path: '/zwift-alternative',
	title: 'A free Zwift alternative for riding with friends — WattRoom',
	description:
		'No subscription, no install, no virtual world: a crew space with voice, synced ERG workouts on everyone’s own FTP, and games decided by watts. Open source.',
};

export const GAME_MODES: SitePage = {
	path: '/game-modes',
	title: 'Seven indoor cycling games decided by watts — WattRoom',
	description:
		'Sprint Roulette, Watt Golf, Backyard Ramp, Floor is Lava and more: group games for smart trainers where your power is the whole game. No avatars, no drafting.',
};

export const FTP_TEST: SitePage = {
	path: '/ftp-test',
	title: 'Free online FTP ramp test for your smart trainer — WattRoom',
	description:
		'Take a ramp test in your browser: a warm-up, then +20 W a minute until you cannot hold it. Your FTP is 75 % of your best minute. Free, about 12–18 minutes.',
};

export const SMART_TRAINER_APP: SitePage = {
	path: '/smart-trainer-app',
	title: 'A free smart trainer app that runs in your browser — WattRoom',
	description:
		'Control an FTMS smart trainer in ERG mode straight from Chrome or Edge: no install, no subscription. Heart-rate, power and cadence sensors pair the same way.',
};

export const SELF_HOST: SitePage = {
	path: '/self-host',
	title: 'Self-host WattRoom — open-source group indoor cycling',
	description:
		'One Go binary, Postgres and LiveKit in a Docker Compose stack: run your club’s own group-ride server. Free software under the AGPL, built in Switzerland.',
};

export const GERMAN: SitePage = {
	path: '/de',
	title: 'WattRoom — Rollentraining mit Freunden, kostenlos im Browser',
	description:
		'Die kostenlose Zwift-Alternative ohne Abo: ein Workout für die ganze Crew, jede Vorgabe auf deine FTP, mit Sprachkanal. Direkt im Browser, Open Source.',
	lang: 'de',
};

/** The date the comparisons' facts and prices were last checked. */
export const CHECKED = '2026-09-26';

/**
 * The words search reads for a comparison page. The page itself is one
 * route, vs/[rival], drawn from rivals.ts.
 */
export function versusPage(slug: string, name: string): SitePage {
	return {
		path: `/vs/${slug}`,
		title: `WattRoom vs ${name} — group workouts, voice and price`,
		description: `An honest comparison from the people who make WattRoom: what ${name} does better, what WattRoom does, and what each costs (checked ${monthYear(CHECKED)}).`,
	};
}

/** "September 2026" — the one way a checked date is said. */
export function monthYear(iso: string): string {
	return new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', {
		month: 'long',
		year: 'numeric',
		timeZone: 'UTC',
	});
}

const ORG_ID = `${SITE_ORIGIN}/#org`;

/**
 * The home page's graph: who makes it, the site, and the application itself.
 * WebSite is what Google's site-names feature reads to label a result
 * "WattRoom" rather than "wattroom.ch", at the root alone. The organisation
 * is there because the word is not ours alone — an unrelated studio shares
 * it, and sameAs pins this one to its repository. No aggregateRating: there
 * are no reviews to count, and an invented one is what search penalises.
 */
export function siteGraph(): object {
	return {
		'@context': 'https://schema.org',
		'@graph': [
			{
				'@type': 'Organization',
				'@id': ORG_ID,
				name: SITE_NAME,
				url: `${SITE_ORIGIN}/`,
				logo: `${SITE_ORIGIN}/favicon.png`,
				sameAs: [REPO],
				parentOrganization: {
					'@type': 'Organization',
					name: 'Natron',
					url: 'https://natron.io',
				},
			},
			{
				'@type': 'WebSite',
				'@id': `${SITE_ORIGIN}/#site`,
				name: SITE_NAME,
				url: `${SITE_ORIGIN}/`,
				description: LANDING.description,
				inLanguage: 'en',
				publisher: { '@id': ORG_ID },
			},
			webApplication(),
		],
	};
}

/** The application, as a software entity search can file. */
export function webApplication(): object {
	return {
		'@type': 'WebApplication',
		'@id': `${SITE_ORIGIN}/#app`,
		name: SITE_NAME,
		url: `${SITE_ORIGIN}/`,
		applicationCategory: 'SportsApplication',
		operatingSystem: 'Windows, macOS, Linux, Android',
		browserRequirements: 'Chrome or Edge; Web Bluetooth to control a trainer',
		isAccessibleForFree: true,
		license: 'https://www.gnu.org/licenses/agpl-3.0.html',
		offers: { '@type': 'Offer', price: '0', priceCurrency: 'CHF' },
		featureList: [
			'Crews with text and voice channels',
			'Structured ERG workouts ridden together, each target on the rider’s own FTP',
			'Seven game modes decided by power',
			'A shared jukebox per voice channel',
			'Ramp FTP test',
			'.fit export and Strava upload',
		],
		publisher: { '@id': ORG_ID },
	};
}

/** A dated page — the comparisons, whose facts go stale. */
export function article(page: SitePage, modified: string = CHECKED): object {
	return {
		'@context': 'https://schema.org',
		'@type': 'Article',
		headline: page.title,
		description: page.description,
		url: SITE_ORIGIN + page.path,
		dateModified: modified,
		author: {
			'@type': 'Organization',
			name: SITE_NAME,
			url: `${SITE_ORIGIN}/`,
		},
		publisher: { '@type': 'Organization', name: SITE_NAME },
	};
}

/**
 * A JSON-LD document as the text of a script element. JSON.stringify leaves
 * `<` alone, so a "</script>" anywhere in a string would close the element
 * early; escaped, it is the same JSON and cannot.
 */
export function jsonLd(doc: unknown): string {
	return JSON.stringify(doc)
		.replaceAll('<', '\\u003c')
		.replaceAll('>', '\\u003e')
		.replaceAll('&', '\\u0026');
}
