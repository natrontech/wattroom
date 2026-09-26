import { RIVALS } from './rivals';
import {
	FTP_TEST,
	GAME_MODES,
	GERMAN,
	GROUP_WORKOUTS,
	LANDING,
	SELF_HOST,
	SMART_TRAINER_APP,
	versusPage,
	ZWIFT_ALTERNATIVE,
	type SitePage,
} from './seo';

/**
 * Every prerendered page, in the order the sitemap lists them (ADR-0061). A
 * page that is not here is not in the sitemap, and seo.test.ts fails on a
 * (site) route missing from it.
 */
export const SITE_PAGES: readonly SitePage[] = [
	LANDING,
	GROUP_WORKOUTS,
	ZWIFT_ALTERNATIVE,
	...RIVALS.map((r) => versusPage(r.slug, r.name)),
	GAME_MODES,
	FTP_TEST,
	SMART_TRAINER_APP,
	SELF_HOST,
	GERMAN,
];

/** The same page in the other language, for hreflang. */
export const TRANSLATIONS: Readonly<Record<string, SitePage>> = {
	[LANDING.path]: GERMAN,
	[GERMAN.path]: LANDING,
};
