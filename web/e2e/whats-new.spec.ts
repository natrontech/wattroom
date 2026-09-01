import { expect, test } from '@playwright/test';
import { signInTo } from './signin';

/**
 * What's new renders whatever the changelog says (#345). The page died in
 * production on 2026.09.3 because its {#each} blocks were keyed by content and
 * one entry used `deploy/` twice in the same line — duplicate keys, and Svelte
 * takes the whole block down.
 *
 * The fixture below is therefore not arbitrary: every field a changelog entry
 * can legitimately repeat is repeated in it. A render-only list must not care.
 */
const CHANGELOG = `# Changelog

Preamble.

## [Unreleased]

## [2026.09.9] - 2026-09-09

### Removed

- \`deploy/\` no longer ships an updater, and \`deploy/\` is the reference now.
- \`deploy/\` again, so two items in one section collide too.

### Removed

- A second section with a heading that already appeared.

## [2026.09.8] - 2026-09-08

### Fixed

- Something else.

[Unreleased]: https://example/compare/2026.09.9...HEAD
`;

test('what’s new survives a changelog that repeats itself', async ({
	page,
}) => {
	const errors: string[] = [];
	page.on('pageerror', (err) => errors.push(String(err)));

	await page.route('**/changelog.md', (route) =>
		route.fulfill({
			status: 200,
			contentType: 'text/markdown',
			body: CHANGELOG,
		}),
	);

	await signInTo(page, '/whats-new');

	// Both releases render, so the each block did not blow up part-way.
	await expect(page.getByText('2026.09.9')).toBeVisible();
	await expect(page.getByText('2026.09.8')).toBeVisible();

	// The line with the repeated code span renders it twice, as written.
	await expect(page.getByText('deploy/', { exact: true })).toHaveCount(3);

	expect(errors, 'the page threw while rendering the changelog').toEqual([]);
});
