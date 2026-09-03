/**
 * Keep a Changelog (#345) parsed in the browser. The file ships as a static
 * asset from the same build as the binary, so what a rider reads always
 * matches the version they are running.
 *
 * Deliberately not a markdown renderer: the format is regular, we control the
 * file, and the only inline markup our entries use is backtick code.
 */
export interface Section {
	heading: string;
	items: string[];
}

export interface Release {
	/** "2026.09.1", or "Unreleased" for the open section. */
	version: string;
	/** ISO date, or null for Unreleased. */
	date: string | null;
	sections: Section[];
}

const HEADING = /^##\s+\[([^\]]+)\]\s*(?:-\s*(\d{4}-\d{2}-\d{2}))?/;
const SUBHEADING = /^###\s+(.+?)\s*$/;
const ITEM = /^[-*]\s+(.*)$/;
/** `[Unreleased]: https://…` link definitions at the foot of the file. */
const LINK_DEF = /^\[[^\]]+\]:\s/;

export function parseChangelog(text: string): Release[] {
	const releases: Release[] = [];
	let release: Release | null = null;
	let section: Section | null = null;

	for (const line of text.split('\n')) {
		if (LINK_DEF.test(line)) continue;

		const heading = HEADING.exec(line);
		if (heading) {
			release = { version: heading[1], date: heading[2] ?? null, sections: [] };
			releases.push(release);
			section = null;
			continue;
		}
		if (!release) continue; // preamble

		const sub = SUBHEADING.exec(line);
		if (sub) {
			section = { heading: sub[1], items: [] };
			release.sections.push(section);
			continue;
		}

		const item = ITEM.exec(line);
		if (item && section) {
			section.items.push(item[1].trim());
			continue;
		}
		// A wrapped continuation line belongs to the item above it.
		if (section?.items.length && line.startsWith('  ') && line.trim()) {
			section.items[section.items.length - 1] += ` ${line.trim()}`;
		}
	}

	return releases;
}

/** Released versions only, newest first — Unreleased is not news to a rider. */
export function releasedOnly(releases: Release[]): Release[] {
	return releases.filter((r) => r.date !== null && r.version !== 'Unreleased');
}

/**
 * Which release to announce, if any — the three rules that keep this from
 * becoming an annoyance, in one testable place (#345):
 * - a dev build is not a release, so there is nothing to announce
 * - a first visit has no previous version, so nobody upgraded
 * - a version with no changelog section has nothing to say
 */
export function releaseToAnnounce(
	current: string | null,
	seen: string | null,
	releases: Release[],
): Release | null {
	if (current === null || seen === null || seen === current) return null;
	return releases.find((r) => r.version === current) ?? null;
}

/** Split on backticks so a call site can render the odd runs as code. */
export function inlineParts(text: string): { code: boolean; text: string }[] {
	return text
		.split('`')
		.map((part, i) => ({ code: i % 2 === 1, text: part }))
		.filter((part) => part.text !== '');
}

/**
 * The releases a rider never got a notice for — everything between the one
 * being announced and the last one they saw (#631). WattRoom ships
 * continuously, so someone who rides once a fortnight comes back across
 * several tags; the notice announces the newest and counts these.
 *
 * The list is newest-first, so "between" is an index span. A stored version
 * the changelog does not know, and a stored version *newer* than the running
 * one (a rollback — ADR-0019 makes that an image tag away), both yield
 * nothing rather than a guess.
 */
export function skippedReleases(
	current: string | null,
	seen: string | null,
	releases: Release[],
): Release[] {
	if (current === null || seen === null || seen === current) return [];
	const announced = releases.findIndex((r) => r.version === current);
	const last = releases.findIndex((r) => r.version === seen);
	if (announced === -1 || last === -1 || last <= announced) return [];
	return releases.slice(announced + 1, last);
}

/**
 * The actions a notice carries: those introduced by the release being
 * announced, plus any from the releases the rider skipped past. Without the
 * second half, whatever a missed release shipped is never offered at all.
 */
export function actionsFor<T extends { version: string }>(
	announced: Release,
	skipped: Release[],
	actions: T[],
): T[] {
	const news = new Set([announced.version, ...skipped.map((r) => r.version)]);
	return actions.filter((a) => news.has(a.version));
}

/**
 * A period only ends a sentence when whitespace follows it and it is not
 * inside a backtick run — `.fit` and `deploy/` are why. The floor keeps an
 * abbreviation ("e.g. ") from truncating an entry to three words.
 */
const SENTENCE_FLOOR = 30;

/** The first sentence of an entry — the notice has room for one line each. */
export function headline(item: string): string {
	let code = false;
	for (let i = 0; i < item.length; i++) {
		if (item[i] === '`') code = !code;
		if (code || item[i] !== '.' || i < SENTENCE_FLOOR) continue;
		const next = item[i + 1];
		if (next === undefined) return item;
		if (/\s/.test(next)) return item.slice(0, i + 1);
	}
	return item;
}

export interface Highlight {
	/** The section it came from — "Added", "Fixed". */
	heading: string;
	text: string;
}

/**
 * What the release says, short enough to read from a bike: the opening
 * sentence of each entry in changelog order (Added first), capped, with the
 * remainder counted so the link to the rest is an offer rather than a
 * surprise.
 */
export function highlights(
	release: Release,
	limit: number,
): { lines: Highlight[]; more: number } {
	const all = release.sections.flatMap((s) =>
		s.items.map((item) => ({ heading: s.heading, text: headline(item) })),
	);
	return { lines: all.slice(0, limit), more: Math.max(0, all.length - limit) };
}
