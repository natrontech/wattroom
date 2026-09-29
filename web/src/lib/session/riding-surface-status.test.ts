import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { code } from '$lib/source-scan.test-helper';

/**
 * A status goes where the rider's name goes, except the riding surface
 * (ADR-0060, amended by #2872). At three metres a written status is noise
 * beside the numbers, and it was drawn up to five times on one session
 * screen. These are the surface's parts and the screens that hold them; a
 * new one joins the list rather than the status joining it.
 */
const RIDING_SURFACE = [
	'lib/session/CrewStrip.svelte',
	'lib/session/SprintMoment.svelte',
	'lib/session/GamePanel.svelte',
	'lib/ride/SessionSummary.svelte',
	'lib/session/SessionControls.svelte',
	'lib/session/Training.svelte',
	'lib/session/TrainingPhone.svelte',
	'lib/session/TvMode.svelte',
	'lib/session/TvOverlay.svelte',
	'lib/ride/FreeRide.svelte',
	'lib/ride/RidingScreen.svelte',
];

const SRC = join(import.meta.dirname, '../..');

describe('the riding surface draws no status (#2872)', () => {
	it.each(RIDING_SURFACE)('%s', (file) => {
		expect(code(readFileSync(join(SRC, file), 'utf8'))).not.toMatch(
			/\bStatusMark\b|\bstatusLine\b/,
		);
	});
});
