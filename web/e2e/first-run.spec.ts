import { expect, test } from '@playwright/test';
import { signInAs } from './signin';

/**
 * The first-run card (#1333, #1857): a rider who has never ridden sees what
 * to do first on Home, and the step is a link to where it is done. This
 * rider never rides, so the card is there every run — and the account that
 * needs it most is exactly one with no ride and no crew to speak of, which
 * is the account #1857 found never saw it.
 */
test('a rider who has never ridden is shown the first step on Home', async ({
	page,
}) => {
	await signInAs(page, 'First Run Rider', '/home');
	await expect(page.getByText(/getting set up/)).toBeVisible();
	const first = page.getByRole('link', { name: /Take your first ride/ });
	await expect(first).toBeVisible();
	await first.click();
	await expect(page).toHaveURL(/\/settings\/equipment$/);
});

/**
 * The step above it (#1484): an account is created holding 200 W and 75 kg
 * that nobody chose, and every FTP-relative target scales from them. The ask
 * is answered in place and the answer retires the step — and until it is
 * answered, the FTP tile says the number is a guess and w/kg is withheld
 * rather than dividing one guess by another.
 */
test('a new account is asked for its FTP and weight, and answering retires the step', async ({
	page,
}) => {
	test.skip(
		!!process.env.WATTROOM_SYNTHETIC_TOKEN,
		'this needs an account that has never answered, and must not purge the production synthetic',
	);
	// A source only ever moves away from "nobody chose it" — by design, so a
	// rider cannot talk their way back into being unasked. This spec's rider
	// is stable and reused, so the run that answered leaves nothing to ask
	// the next time: purge the account through the rider's own route and come
	// back through the same door, which mints it afresh.
	await signInAs(page, 'Unasked Rider', '/home');
	expect((await page.request.delete('/api/me')).ok()).toBeTruthy();
	await signInAs(page, 'Unasked Rider', '/home');

	const ask = page.getByText('Set your FTP and weight');
	await expect(ask).toBeVisible();
	// Above "Take your first ride", because it is above it in consequence.
	const labels = await page
		.getByText(/Set your FTP and weight|Take your first ride/)
		.allInnerTexts();
	expect(labels[0]).toContain('Set your FTP and weight');

	const ftp = page.getByRole('spinbutton', { name: /FTP/ });
	const kg = page.getByRole('spinbutton', { name: /weight/ });
	await expect(ftp).toHaveValue('200');
	await expect(kg).toHaveValue('75');

	// Nothing measured, so nothing reads as measured.
	await expect(
		page.getByText(/a starting guess, not a measurement/),
	).toBeVisible();
	await expect(page.getByText(/w\/kg/)).toHaveCount(0);

	await ftp.fill('247');
	await kg.fill('71');
	await page.getByRole('button', { name: 'Save' }).click();

	// The step retires itself, and the tile stops apologising for the number.
	await expect(page.getByRole('spinbutton', { name: /FTP/ })).toHaveCount(0);
	await expect(
		page.getByText(/a starting guess, not a measurement/),
	).toHaveCount(0);
	await expect(page.getByText('3.5 w/kg')).toBeVisible();
});
