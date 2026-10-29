import { expect, type Page } from '@playwright/test';

/**
 * An in-app navigation, as a link in the sidebar makes one: the router's
 * own, so a guard would see it and the ride in memory survives it. A
 * page.goto would reload the app and rightly lose the ride. Mid-ride nothing
 * asks on the way (ADR-0093).
 */
export async function follow(page: Page, path: string): Promise<void> {
	await page.evaluate((href) => {
		const link = document.createElement('a');
		link.href = href;
		document.body.append(link);
		link.click();
		link.remove();
	}, path);
	await page.waitForURL((url) => url.pathname === path, { timeout: 15_000 });
	await expect(
		page.getByRole('dialog'),
		`opening ${path} asked something mid-ride`,
	).toHaveCount(0);
}
