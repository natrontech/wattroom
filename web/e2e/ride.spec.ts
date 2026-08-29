import { expect, test } from '@playwright/test';

/**
 * WATTROOM.md's single end-to-end flow: simulated trainer → ride a 2-minute
 * workout → .fit produced.
 *
 * The value is the seam. Unit tests cover the workout engine, the session logic and
 * the FIT encoder separately; only this proves a ride actually reaches a file —
 * browser loop, HTTP, and the Go encoder in one line. It rides in real time on
 * purpose: compressing the clock would stop testing the thing that broke before.
 */
test('a simulated ride produces a .fit file', async ({ page }) => {
	// ?w= selects from the curated library; "openers" is the two-minute one.
	await page.goto('/ride?w=openers');
	await expect(page.getByRole('heading', { name: 'Openers' })).toBeVisible();
	await page.getByRole('button', { name: 'Ride simulated' }).click();

	// The ride is live once power is arriving.
	const watts = page.locator('.text-watt.glow-text-strong').first();
	await expect(watts).not.toHaveText('0', { timeout: 15_000 });

	// The clock has to actually advance — a frozen session still renders numbers,
	// which is exactly how a reactivity bug shipped once already.
	const firstRemaining = await page.getByText('remaining').locator('..').innerText();
	await page.waitForTimeout(3000);
	expect(await page.getByText('remaining').locator('..').innerText()).not.toBe(firstRemaining);

	// Ride it out. 120 s of workout plus slack for the browser's timer drift.
	const download = page.getByTestId('download-fit');
	await expect(download).toBeVisible({ timeout: 180_000 });

	const [file] = await Promise.all([page.waitForEvent('download'), download.click()]);

	expect(file.suggestedFilename()).toMatch(/^wattroom-.*\.fit$/);

	const path = await file.path();
	expect(path).toBeTruthy();

	// A .fit begins with a header whose bytes 8..12 spell ".FIT". Checking that
	// rather than "a file arrived" is what makes this a real assertion.
	const { readFile } = await import('node:fs/promises');
	const bytes = await readFile(path!);
	expect(bytes.length).toBeGreaterThan(100);
	expect(bytes.subarray(8, 12).toString('ascii')).toBe('.FIT');

	// The same finished ride is kept locally (#14). Asserting it here rather than in
	// its own test reuses the two minutes already spent riding.
	await page.goto('/history');
	const ride = page.getByText('Openers').first();
	await expect(ride).toBeVisible();
	await expect(page.getByText('No rides yet')).toHaveCount(0);
});
