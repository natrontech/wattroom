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

/** "8 added · 1 changed · 1 security" — enough for a glance from a bike. */
export function summarize(release: Release): string {
	return release.sections
		.map((s) => `${s.items.length} ${s.heading.toLowerCase()}`)
		.join(' · ');
}

/** Split on backticks so a call site can render the odd runs as code. */
export function inlineParts(text: string): { code: boolean; text: string }[] {
	return text
		.split('`')
		.map((part, i) => ({ code: i % 2 === 1, text: part }))
		.filter((part) => part.text !== '');
}
