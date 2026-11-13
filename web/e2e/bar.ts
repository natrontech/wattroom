import type { Page } from '@playwright/test';

/**
 * Presses one of the ride's controls in the now bar. The bar's row never
 * scrolls (#4567): a control it has no room for sits under More, so at the
 * suite's 1280 px a voice channel's ride keeps Start a session there.
 */
export async function pressInBar(page: Page, name: string): Promise<void> {
	const row = page.getByTestId('ride-controls');
	const button = row.getByRole('button', { name, exact: true });
	const more = row.getByRole('button', { name: 'More ride controls' });
	await button.or(more).first().waitFor();
	if (await button.isVisible()) return button.click();
	await more.click();
	await page.getByRole('menuitem', { name, exact: true }).click();
}
