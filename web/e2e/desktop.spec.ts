import { expect, test } from '@playwright/test';
import { signInAs } from './signin';

/**
 * The desktop app's two web-side surfaces (#296): /download picks the
 * installer for the computer you are on, and the home page tells a rider
 * inside the shell when a newer build is out. The unit tests cover the
 * parsing and the comparison; this covers the wiring — that the feed is
 * actually read, that the platform actually selects, and that a dismissed
 * version stays dismissed across a reload.
 *
 * The feed is GitHub's releases/latest for the releases repo, mocked here
 * because the real one is a 404 until that repo exists, and would be a
 * network dependency in CI after.
 */
const FEED = 'https://api.github.com/repos/natrontech/wattroom-releases/**';

const RELEASE = {
	tag_name: 'desktop-v0.2.0',
	html_url:
		'https://github.com/natrontech/wattroom-releases/releases/tag/desktop-v0.2.0',
	assets: [
		{
			name: 'WattRoom-0.2.0-mac-arm64.dmg',
			browser_download_url: 'https://dl.test/WattRoom-0.2.0-mac-arm64.dmg',
			size: 128377524,
		},
		{
			name: 'WattRoom-0.2.0-win-x64.exe',
			browser_download_url: 'https://dl.test/WattRoom-0.2.0-win-x64.exe',
			size: 90000000,
		},
		{
			name: 'latest-mac.yml',
			browser_download_url: 'https://dl.test/latest-mac.yml',
			size: 353,
		},
	],
};

test.describe('the download page', () => {
	// A fixed platform, so the assertion is about detection and not about
	// whichever machine runs the suite.
	test.use({
		userAgent:
			'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
	});

	test('offers the installer for this computer first, without signing in', async ({
		page,
	}) => {
		await page.route(FEED, (route) => route.fulfill({ json: RELEASE }));
		await page.goto('/download');

		const primary = page.getByRole('link', { name: /Download 0\.2\.0/ });
		await expect(primary).toBeVisible();
		await expect(primary).toHaveAttribute(
			'href',
			'https://dl.test/WattRoom-0.2.0-win-x64.exe',
		);
		// The other platform is offered, the update manifest is not.
		await expect(page.getByRole('link', { name: /macOS · dmg/ })).toBeVisible();
		await expect(page.getByText('latest-mac.yml')).toHaveCount(0);
		// The first-launch note is the one for the detected platform.
		await expect(page.getByText(/Run anyway/)).toBeVisible();
	});

	test('teaches instead of apologising while no build exists', async ({
		page,
	}) => {
		await page.route(FEED, (route) =>
			route.fulfill({ status: 404, json: { message: 'Not Found' } }),
		);
		await page.goto('/download');
		await expect(
			page.getByText(/No desktop build is published yet/),
		).toBeVisible();
		await expect(page.getByRole('link', { name: /Download/ })).toHaveCount(0);
	});
});

test('inside the shell, home says when a newer build is out — once', async ({
	page,
}) => {
	await page.route(FEED, (route) => route.fulfill({ json: RELEASE }));
	// What preload.js exposes; the app feature-detects it (ADR-0037).
	await page.addInitScript(() => {
		Object.assign(window, {
			wattroom: { version: '0.1.0', platform: 'win32' },
		});
	});
	await signInAs(page, 'Desktop Update', '/home');

	const notice = page.getByText(/WattRoom 0\.2\.0 is out — you are on 0\.1\.0/);
	await expect(notice).toBeVisible();
	await expect(
		page.getByRole('link', { name: 'Get the update' }),
	).toHaveAttribute('href', '/download');

	await page.getByRole('button', { name: 'Not now' }).click();
	await expect(notice).toHaveCount(0);

	// Dismissed is remembered: the same version does not come back on reload.
	await page.reload();
	await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
	await expect(notice).toHaveCount(0);
});

test('in a browser, home never mentions the desktop build', async ({
	page,
}) => {
	await page.route(FEED, (route) => route.fulfill({ json: RELEASE }));
	await signInAs(page, 'Desktop Browser', '/home');
	await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
	await expect(page.getByText(/is out — you are on/)).toHaveCount(0);
});
