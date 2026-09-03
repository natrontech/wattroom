import { describe, expect, it } from 'vitest';
import {
	actionsFor,
	headline,
	highlights,
	inlineParts,
	parseChangelog,
	releasedOnly,
	releaseToAnnounce,
	skippedReleases,
	summarize,
} from './changelog';

// The shape the real CHANGELOG.md has, including the parts that have already
// bitten once: link definitions at the foot, and wrapped item lines.
const SAMPLE = `# Changelog

Preamble prose that is not part of any release.

## [Unreleased]

## [2026.09.2] - 2026-09-02

### Fixed

- Sprint moments no longer fire twice when two riders cross the trigger
  in the same tick.

## [2026.09.1] - 2026-09-01

### Added

- The \`.fit\` export.
- Rooms.

### Security

- \`/metrics\` is no longer public.

[Unreleased]: https://example/compare/2026.09.2...HEAD
[2026.09.1]: https://example/releases/tag/2026.09.1
`;

describe('parseChangelog', () => {
	const releases = parseChangelog(SAMPLE);

	it('reads every heading, newest first', () => {
		expect(releases.map((r) => r.version)).toEqual([
			'Unreleased',
			'2026.09.2',
			'2026.09.1',
		]);
	});

	it('dates released sections and leaves Unreleased undated', () => {
		expect(releases[0].date).toBeNull();
		expect(releases[1].date).toBe('2026-09-02');
	});

	it('joins a wrapped item into one entry', () => {
		expect(releases[1].sections[0].items).toEqual([
			'Sprint moments no longer fire twice when two riders cross the trigger in the same tick.',
		]);
	});

	it('keeps sections in order with their own items', () => {
		expect(releases[2].sections.map((s) => s.heading)).toEqual([
			'Added',
			'Security',
		]);
		expect(releases[2].sections[0].items).toHaveLength(2);
	});

	// The link block sits after the last release, so a parser that only stops
	// at the next heading swallows it — the bug that reached the first release
	// notes before it was caught.
	it('ignores the link definitions at the foot', () => {
		const all = releases.flatMap((r) => r.sections.flatMap((s) => s.items));
		expect(all.some((item) => item.includes('https://'))).toBe(false);
	});

	it('survives an empty file', () => {
		expect(parseChangelog('')).toEqual([]);
	});
});

describe('releasedOnly', () => {
	it('drops Unreleased', () => {
		expect(releasedOnly(parseChangelog(SAMPLE)).map((r) => r.version)).toEqual([
			'2026.09.2',
			'2026.09.1',
		]);
	});
});

describe('inlineParts', () => {
	it('marks the backticked runs as code', () => {
		expect(inlineParts('The `.fit` export.')).toEqual([
			{ code: false, text: 'The ' },
			{ code: true, text: '.fit' },
			{ code: false, text: ' export.' },
		]);
	});

	it('handles an item that starts with code', () => {
		expect(inlineParts('`/metrics` is no longer public.')).toEqual([
			{ code: true, text: '/metrics' },
			{ code: false, text: ' is no longer public.' },
		]);
	});

	it('leaves plain text alone', () => {
		expect(inlineParts('Rooms.')).toEqual([{ code: false, text: 'Rooms.' }]);
	});
});

describe('summarize', () => {
	const [, , first] = parseChangelog(SAMPLE);

	it('counts each section for a glance', () => {
		expect(summarize(first)).toBe('2 added · 1 security');
	});

	it('is empty for a release with no sections', () => {
		expect(summarize({ version: 'x', date: null, sections: [] })).toBe('');
	});
});

describe('releaseToAnnounce', () => {
	const releases = releasedOnly(parseChangelog(SAMPLE));

	it('announces the running release when it is new to this browser', () => {
		expect(releaseToAnnounce('2026.09.2', '2026.09.1', releases)?.version).toBe(
			'2026.09.2',
		);
	});

	it('says nothing on a first visit — nobody upgraded', () => {
		expect(releaseToAnnounce('2026.09.2', null, releases)).toBeNull();
	});

	it('says nothing on a dev build — not a release', () => {
		expect(releaseToAnnounce(null, '2026.09.1', releases)).toBeNull();
	});

	it('says nothing when the rider already saw this version', () => {
		expect(releaseToAnnounce('2026.09.2', '2026.09.2', releases)).toBeNull();
	});

	it('says nothing when the running version has no changelog section', () => {
		expect(releaseToAnnounce('2026.09.9', '2026.09.1', releases)).toBeNull();
	});
});

// Four releases, because the whole point of #631 is the rider who was away
// across several of them.
const SPAN = releasedOnly(
	parseChangelog(`# Changelog

## [2026.09.25] - 2026-09-05

### Added

- A fifth theme.

## [2026.09.24] - 2026-09-04

### Fixed

- One thing.

## [2026.09.23] - 2026-09-03

### Added

- Monokai.

## [2026.09.22] - 2026-09-02

### Added

- Playlists.
`),
);

describe('skippedReleases', () => {
	it('lists what landed between the announced release and the last one seen', () => {
		expect(
			skippedReleases('2026.09.25', '2026.09.22', SPAN).map((r) => r.version),
		).toEqual(['2026.09.24', '2026.09.23']);
	});

	it('is empty when the rider missed nothing but the announced release', () => {
		expect(skippedReleases('2026.09.25', '2026.09.24', SPAN)).toEqual([]);
	});

	it('is empty on a first visit and on a dev build', () => {
		expect(skippedReleases('2026.09.25', null, SPAN)).toEqual([]);
		expect(skippedReleases(null, '2026.09.22', SPAN)).toEqual([]);
	});

	// Rollback is an image tag away (ADR-0019), so the stored version can be
	// newer than the running one. Counting that span backwards would claim the
	// rider missed releases they have already read.
	it('is empty when the stored version is newer than the running one', () => {
		expect(skippedReleases('2026.09.23', '2026.09.25', SPAN)).toEqual([]);
	});

	it('is empty when the changelog does not know the stored version', () => {
		expect(skippedReleases('2026.09.25', '2026.08.9', SPAN)).toEqual([]);
	});
});

describe('actionsFor', () => {
	const [announced, ...older] = SPAN;
	const catalogue = [
		{ id: 'theme', version: '2026.09.25' },
		{ id: 'monokai', version: '2026.09.23' },
		{ id: 'ancient', version: '2026.09.20' },
	];

	it('offers what the announced release introduced', () => {
		expect(actionsFor(announced, [], catalogue).map((a) => a.id)).toEqual([
			'theme',
		]);
	});

	// Without this, whatever a missed release shipped is never offered at all.
	it('offers what a skipped release introduced', () => {
		const skipped = skippedReleases('2026.09.25', '2026.09.22', SPAN);
		expect(actionsFor(announced, skipped, catalogue).map((a) => a.id)).toEqual([
			'theme',
			'monokai',
		]);
	});

	it('leaves out an action from a release the rider already saw', () => {
		expect(actionsFor(older[0], [], catalogue)).toEqual([]);
	});
});

describe('headline', () => {
	it('keeps the first sentence', () => {
		expect(
			headline(
				'Deleting a room now clears everything live about it. The slug it frees can be reused.',
			),
		).toBe('Deleting a room now clears everything live about it.');
	});

	// `.fit` and `deploy/` are why a period alone cannot end a sentence.
	it('does not break inside a backticked run', () => {
		expect(headline('The long-awaited `.fit` export, at last, arrives.')).toBe(
			'The long-awaited `.fit` export, at last, arrives.',
		);
	});

	it('leaves a one-sentence entry whole', () => {
		expect(headline('Rooms are a thing you can open now.')).toBe(
			'Rooms are a thing you can open now.',
		);
	});

	it('does not truncate at an abbreviation near the start', () => {
		expect(
			headline('Sprints, e.g. the ones you set, no longer double-fire.'),
		).toBe('Sprints, e.g. the ones you set, no longer double-fire.');
	});
});

describe('highlights', () => {
	const release = parseChangelog(`## [2026.09.25] - 2026-09-05

### Added

- The jukebox now keeps saved playlists for a room. Any member can edit them.
- Two.

### Fixed

- Three.
- Four.
`)[0];

	it('takes the opening sentences in changelog order and counts the rest', () => {
		const { lines, more } = highlights(release, 3);
		expect(lines).toEqual([
			{
				heading: 'Added',
				text: 'The jukebox now keeps saved playlists for a room.',
			},
			{ heading: 'Added', text: 'Two.' },
			{ heading: 'Fixed', text: 'Three.' },
		]);
		expect(more).toBe(1);
	});

	it('does not promise more when it showed everything', () => {
		expect(highlights(release, 9).more).toBe(0);
	});
});
