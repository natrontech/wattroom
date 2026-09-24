import { expect, test } from '@playwright/test';
import { signInAs } from './signin';

/**
 * File import end to end (#2327): the browser reads the file, the converter
 * runs in the page, and the result lands on the account's shelf through the
 * same POST the editor's Save uses. The unit tests own the conversion; this
 * owns the seam — a FileList, a preview the rider reads, and a workout that
 * is really there afterwards.
 *
 * Both fixtures are hand-written. An intervals.icu account commonly syncs
 * from Strava, and AGENTS.md bars Strava Data from any fixture.
 */
// Unique to the run: this spec's rider keeps their shelf between runs
// against a worktree's dev database, and two workouts of one name would make
// the assertion below ambiguous rather than wrong (#2083).
const RUN = Date.now().toString(36);
const NAME = `Coach Tuesday ${RUN}`;

const ZWO = `<?xml version="1.0" encoding="UTF-8"?>
<workout_file>
  <name>${NAME}</name>
  <author>A Coach</author>
  <description>Threshold work</description>
  <workout>
    <Warmup Duration="600" PowerLow="0.4" PowerHigh="0.7"/>
    <SteadyState Duration="1200" Power="0.9" CadenceLow="85" CadenceHigh="95"/>
    <IntervalsT Repeat="4" OnDuration="30" OffDuration="90" OnPower="1.2" OffPower="0.55"/>
    <FreeRide Duration="900"/>
    <SteadyState Duration="300" Power="0.6" Cadence="95">
      <TextEvent timeoffset="10" message="Settle in"/>
    </SteadyState>
    <Cooldown Duration="300" PowerLow="0.6" PowerHigh="0.35"/>
  </workout>
</workout_file>`;

const ERG_NAME = `coach-ramp-${RUN}`;
const ERG = `[COURSE HEADER]
VERSION = 2
UNITS = ENGLISH
DESCRIPTION = coach ramp
FTP = 200
MINUTES WATTS
[END COURSE HEADER]
[COURSE DATA]
0.00\t100
10.00\t200
10.00\t190
25.00\t190
[END COURSE DATA]`;

test('import a .zwo, read what it lost, and save it to the shelf', async ({
	page,
}) => {
	// Mute before you play (AGENTS.md): nothing here queues media, but the
	// shell's cue bus loads on mount and this costs one line.
	await page.addInitScript(() =>
		localStorage.setItem(
			'wattroom.mixer.v1',
			JSON.stringify({ music: 0, cues: 0, board: 0, share: 0 }),
		),
	);
	await signInAs(page, 'Import Verify', '/workouts/import');

	await expect(
		page.getByRole('heading', { name: 'Import a workout' }),
	).toBeVisible();
	await expect(
		page.getByRole('button', { name: 'Choose a file' }),
	).toBeVisible();

	await page.locator('input[type=file]').setInputFiles({
		name: 'coach-tuesday.zwo',
		mimeType: 'application/xml',
		buffer: Buffer.from(ZWO),
	});

	await expect(page.getByRole('heading', { name: NAME })).toBeVisible();
	// 600 + 1200 + 4*(30+90) + 300 + 300 = 2880, the free ride left out.
	await expect(page.getByText('48:00', { exact: true })).toBeVisible();
	await expect(page.getByText(/free-ride/)).toBeVisible();
	await expect(page.getByText(/15:00 shorter/)).toBeVisible();
	await expect(page.getByText(/one exact cadence/)).toBeVisible();
	await expect(page.getByText(/ride instruction/)).toBeVisible();
	await expect(page.getByText(/description was left out/)).toBeVisible();

	// The first save meets a server having a moment (#2627): the preview,
	// what the file lost and both Save buttons stay, and Try again saves.
	let refused = false;
	await page.route('**/api/workouts', (route) => {
		if (route.request().method() !== 'POST' || refused) return route.fallback();
		refused = true;
		return route.fulfill({
			status: 503,
			json: { error: 'rate_limited', message: 'The server is busy.' },
		});
	});
	await page.getByRole('button', { name: 'Save to my shelf' }).click();
	await expect(page.getByText('The server is busy.')).toBeVisible();
	await expect(page.getByRole('heading', { name: NAME })).toBeVisible();
	await expect(page.getByText(/free-ride/)).toBeVisible();
	await expect(
		page.getByRole('button', { name: 'Save and edit' }),
	).toBeVisible();

	await page.getByRole('button', { name: 'Try again' }).click();
	await page.waitForURL('**/workouts');
	await expect(
		page.getByRole('link', { name: NAME, exact: true }),
	).toBeVisible();
});

test('import a .erg, and refuse the files that are not one', async ({
	page,
}) => {
	await page.addInitScript(() =>
		localStorage.setItem(
			'wattroom.mixer.v1',
			JSON.stringify({ music: 0, cues: 0, board: 0, share: 0 }),
		),
	);
	await signInAs(page, 'Import Verify Erg', '/workouts/import');

	const input = page.locator('input[type=file]');
	await input.setInputFiles({
		name: `${ERG_NAME}.erg`,
		mimeType: 'text/plain',
		buffer: Buffer.from(ERG),
	});
	await expect(page.getByRole('heading', { name: ERG_NAME })).toBeVisible();
	await expect(page.getByText('25:00', { exact: true })).toBeVisible();
	await expect(page.getByText(/200 W FTP the file states/)).toBeVisible();

	await input.setInputFiles({
		name: 'broken.zwo',
		mimeType: 'application/xml',
		buffer: Buffer.from('<workout_file><workout</workout_file>'),
	});
	await expect(page.getByRole('alert')).toContainText('not valid XML');

	await input.setInputFiles({
		name: 'plan.fit',
		mimeType: 'application/octet-stream',
		buffer: Buffer.from('not a workout'),
	});
	await expect(page.getByRole('alert')).toContainText('.zwo and .erg');

	// And back to a good one: the surface recovers without a reload.
	await input.setInputFiles({
		name: `${ERG_NAME}.erg`,
		mimeType: 'text/plain',
		buffer: Buffer.from(ERG),
	});
	await expect(page.getByRole('heading', { name: ERG_NAME })).toBeVisible();
	await page.getByRole('button', { name: 'Save and edit' }).click();
	await page.waitForURL('**/workouts/edit?w=*');
	await expect(page.getByLabel('Workout name')).toHaveValue(ERG_NAME);
});
