import { expect, type Page } from '@playwright/test';

/**
 * A route file, and a stored route to open (#3057, #3061). Invented, in the
 * open South Atlantic: no fixture here is anyone's road (#3054). Three
 * kilometres climbing 4 %, so its one climb is class IV. The file's own
 * <name> is the kind of place name a rider might give a track, and no screen
 * may ever show it.
 */
export const TRACK_NAME = 'My street to the office';

export function routeGpx(): string {
	const perLon = 111_195 * Math.cos((30 * Math.PI) / 180);
	const points = Array.from({ length: 301 }, (_, i) => {
		const lon = -25 + (i * 10) / perLon;
		return `<trkpt lat="-30.0000000" lon="${lon.toFixed(7)}"><ele>${(100 + 0.4 * i).toFixed(1)}</ele></trkpt>`;
	});
	return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="WattRoom e2e" xmlns="http://www.topografix.com/GPX/1/1">
<trk><name>${TRACK_NAME}</name><trkseg>
${points.join('\n')}
</trkseg></trk>
</gpx>`;
}

/**
 * Stores a route the way a rider does — through the importer — and answers
 * its id. The page converts the file, so a seeded route is exactly what a
 * real import stores.
 */
export async function importARoute(page: Page): Promise<string> {
	await page.goto('/workouts/import');
	await page.locator('input[type=file]').setInputFiles({
		name: 'seed.gpx',
		mimeType: 'application/gpx+xml',
		buffer: Buffer.from(routeGpx()),
	});
	await page.getByRole('button', { name: 'Save to my routes' }).click();
	await expect(page.getByText(/is on your routes/)).toBeVisible();
	const { routes } = (await (await page.request.get('/api/routes')).json()) as {
		routes: { id: string }[];
	};
	return routes[0]?.id ?? '';
}
