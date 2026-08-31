import { describe, expect, it } from 'vitest';
import {
	inlineParts,
	parseChangelog,
	releasedOnly,
	releaseToAnnounce,
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
