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

/**
 * A route file through the same door (#3057): the file stays in the browser,
 * the preview says what it became, and Save stores the road — which then
 * reads back under its generated name. Invented, in the open South Atlantic:
 * no fixture here is anyone's road (#3054). Three kilometres climbing 4 %,
 * so the one climb is class IV.
 */
function routeGpx(): string {
	const perLon = 111_195 * Math.cos((30 * Math.PI) / 180);
	const points = Array.from({ length: 301 }, (_, i) => {
		const lon = -25 + (i * 10) / perLon;
		return `<trkpt lat="-30.0000000" lon="${lon.toFixed(7)}"><ele>${(100 + 0.4 * i).toFixed(1)}</ele></trkpt>`;
	});
	return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="WattRoom e2e" xmlns="http://www.topografix.com/GPX/1/1">
<trk><name>My street to the office</name><trkseg>
${points.join('\n')}
</trkseg></trk>
</gpx>`;
}

test('import a .gpx route, read its preview, and save it', async ({ page }) => {
	await page.addInitScript(() =>
		localStorage.setItem(
			'wattroom.mixer.v1',
			JSON.stringify({ music: 0, cues: 0, board: 0, share: 0 }),
		),
	);
	await signInAs(page, 'Import Verify Route', '/workouts/import');

	await page.locator('input[type=file]').setInputFiles({
		name: 'commute.gpx',
		mimeType: 'application/gpx+xml',
		buffer: Buffer.from(routeGpx()),
	});

	// The generated name, never the file's own <name>.
	const heading = page.getByRole('heading', {
		name: /^Road · 3\.0 km · \d+ m$/,
	});
	await expect(heading).toBeVisible();
	const generated = (await heading.textContent())!.trim();
	await expect(page.getByText('My street to the office')).toHaveCount(0);
	await expect(page.getByRole('list', { name: 'Climbs' })).toContainText('IV');
	await expect(page.getByText('At the reference pace')).toBeVisible();
	await expect(page.getByText(/smoothing every route gets/)).toBeVisible();
	await expect(page.getByText(/map is sealed/)).toBeVisible();
	await expect(
		page.getByRole('button', { name: 'Ride it now' }),
	).toBeDisabled();
	await expect(
		page.getByRole('button', { name: 'Plan it for a crew' }),
	).toBeDisabled();

	await page.getByLabel('your name for it').fill('Commute climb');
	await page.getByRole('button', { name: 'Save to my routes' }).click();
	await expect(
		page.getByText(/“Commute climb” is on your routes/),
	).toBeVisible();

	// Stored: the owner's name on their own read, the generated one beside it.
	const listed = await page.request.get('/api/routes');
	expect(listed.ok()).toBe(true);
	const { routes } = (await listed.json()) as {
		routes: { name: string; generatedName: string }[];
	};
	expect(routes).toContainEqual(
		expect.objectContaining({
			name: 'Commute climb',
			generatedName: generated,
		}),
	);
});

/**
 * The intervals.icu pull as the page meets it (#2327). The round trip through
 * intervals.icu's consent page needs a registered client (#3575), so the two
 * reads this page makes are stubbed here; the server's half is Go-tested
 * against a hand-written fake intervals.icu. This owns the landing, the list,
 * a preview through the same importer, a real save, and a pull read once.
 */
test('a pulled week lists, previews and saves, and the pull is read once', async ({
	page,
}) => {
	await page.addInitScript(() =>
		localStorage.setItem(
			'wattroom.mixer.v1',
			JSON.stringify({ music: 0, cues: 0, board: 0, share: 0 }),
		),
	);
	await signInAs(page, 'Import Pull', '/workouts/import');
	// This dev server has no intervals.icu client: nothing is offered.
	await expect(
		page.getByRole('button', { name: 'Choose a file' }),
	).toBeVisible();
	await expect(page.getByText('from intervals.icu')).toHaveCount(0);

	const PLANNED = `Planned Tempo ${RUN}`;
	await page.route('**/api/intervals', (route) =>
		route.fulfill({ json: { available: true } }),
	);
	let opened = 0;
	await page.route('**/api/intervals/pulls/*', (route) => {
		opened += 1;
		return route.fulfill({
			json: {
				workouts: [
					{
						name: PLANNED,
						date: '2026-10-01',
						zwo: `<workout_file><name>${PLANNED}</name><workout><SteadyState Duration="1200" Power="0.8"/></workout></workout_file>`,
					},
				],
				skipped: 1,
			},
		});
	});
	await page.goto('/workouts/import?intervals=a-pull');

	const row = page.getByRole('listitem').filter({ hasText: PLANNED });
	await expect(row).toContainText('2026-10-01');
	await expect(
		page.getByText(
			'1 planned item had no workout file WattRoom can read, and was left out.',
		),
	).toBeVisible();
	await expect(
		page.getByRole('link', { name: 'Pull my planned workouts' }),
	).toHaveAttribute('href', '/api/intervals/start');
	// Spent: a reload would not ask for it again.
	await expect.poll(() => new URL(page.url()).search).toBe('');

	await row.getByRole('button', { name: 'Preview' }).click();
	await expect(page.getByRole('heading', { name: PLANNED })).toBeVisible();
	await expect(page.getByText('20:00', { exact: true }).first()).toBeVisible();
	await page.getByRole('button', { name: 'Save to my shelf' }).click();
	await expect(row).toContainText('On your shelf');
	expect(new URL(page.url()).pathname).toBe('/workouts/import');
	expect(opened).toBe(1);

	await page.goto('/workouts/import?intervals=denied');
	await expect(
		page.getByText(
			'Nothing was pulled: intervals.icu was not given access to your calendar.',
		),
	).toBeVisible();
});
