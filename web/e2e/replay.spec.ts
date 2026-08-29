import { expect, test } from '@playwright/test';

/**
 * The regression harness (#54, ADR-0006): ride a committed fixture — a real
 * captured trace with identity stripped — and assert the ride behaves. Every
 * accepted feedback report converts into one of these; the generic symptom
 * asserted here is the one every report shares: the ride runs on real data
 * without dying.
 */
test('a captured trace replays through the ride', async ({ page }) => {
	const errors: string[] = [];
	page.on('pageerror', (err) => errors.push(String(err)));

	await page.goto('/ride?w=openers&replay=kickr-erg-2026-08-29');
	await page.getByTestId('ride-replay').click();

	// Real captured watts arrive — not the generator's.
	const watts = page.locator('.text-watt.glow-text-strong').first();
	await expect(watts).not.toHaveText('0', { timeout: 20_000 });

	// The clock advances on the replayed data.
	const remaining = page.getByText('remaining').locator('..');
	const first = await remaining.innerText();
	await page.waitForTimeout(3000);
	expect(await remaining.innerText()).not.toBe(first);

	expect(errors).toEqual([]);
});
