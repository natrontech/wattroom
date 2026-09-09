import { expect, test } from '@playwright/test';
import { signInTo } from './signin';

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

	await signInTo(page, '/ride?w=smoke-test&replay=kickr-erg-2026-08-29');
	await page.getByTestId('ride-replay').click();

	// Real captured watts arrive — not the generator's.
	const watts = page.locator('.text-watt.glow-text-strong').first();
	await expect(watts).not.toHaveText('0', { timeout: 20_000 });

	// The clock advances on the replayed data.
	const clock = page.getByTestId('ride-clock');
	const first = await clock.innerText();
	// Poll until the clock moves rather than bet 3 s of wall time on it (#1718):
	// three seconds is ~3 samples on an idle machine and possibly none on a
	// loaded runner.
	await expect(clock).not.toHaveText(first, { timeout: 10_000 });

	expect(errors).toEqual([]);
});
