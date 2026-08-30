import type { Page } from '@playwright/test';

/**
 * Everything is behind sign-in (ADR-0009), so every flow enters like a rider:
 * hit the deep link, get bounced to /login, take the dev provider, land back
 * where we were going. The bounce itself is part of what this exercises.
 */
export async function signInTo(page: Page, path: string): Promise<void> {
	await page.goto(path);
	await page
		.getByRole('button', { name: /Dev sign-in/ })
		.click({ timeout: 15_000 });
}
