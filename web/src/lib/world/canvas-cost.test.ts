import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { code, FILES } from '$lib/source-scan.test-helper';

/**
 * The world draws one pass straight to its canvas and nothing makes the
 * compositor redo it (#3078). Read from source, because a composer or a
 * backdrop blur renders fine and only costs: #3199's backdrop over the stage
 * was ~20 % of a GPU on a 5K display, re-blurred on every frame the video
 * under it moved.
 */

const SRC = join(import.meta.dirname, '..', '..');
const read = (file: string) => code(readFileSync(join(SRC, file), 'utf8'));

/** What sits over the world: the riding surface and everything docked on it. */
const OVER = [
	'lib/world/',
	'lib/session/',
	'lib/ride/',
	'lib/channel/',
	'lib/board/',
];
/** The canvas itself and the slot that hosts it. */
const HOST = ['lib/world/RideWorld.svelte', 'lib/session/RidingSurface.svelte'];

const BACKDROP = /(?<![\w-])backdrop-[\w[\]./-]+|backdrop-filter\s*:/g;
const FILTER =
	/(?<=[\s"'`{:])(?:blur|drop-shadow|brightness|contrast|grayscale|hue-rotate|invert|saturate|sepia)(?:-[\w[\]./-]+)?(?=[\s"'`}])|(?<![\w-])filter\s*:/g;
const POST =
	/(['"])(?:three\/(?:addons|examples\/jsm)\/postprocessing\/[^'"]*|postprocessing)\1|\bEffectComposer\b/g;

const offences = (files: string[], re: RegExp) =>
	files.flatMap((f) => [...read(f).matchAll(re)].map((m) => `  ${f}: ${m[0]}`));

describe('nothing makes the compositor redo the world (#3078)', () => {
	it('adds no post-processing pass', () => {
		const found = offences(
			FILES.filter((f) => !f.endsWith('.test.ts')),
			POST,
		);
		expect(found, `post-processing:\n${found.join('\n')}`).toEqual([]);
	});

	it('puts no backdrop filter over the canvas', () => {
		const files = FILES.filter(
			(f) => f.endsWith('.svelte') && OVER.some((d) => f.startsWith(d)),
		);
		expect(files).toContain('lib/session/RidingSurface.svelte'); // or this proves nothing
		const found = offences(files, BACKDROP);
		expect(
			found,
			`A backdrop over the world is re-filtered on every frame it draws:\n${found.join('\n')}\n` +
				'Use a more opaque surface instead (bg-surface/90), as the stage does since #3199.',
		).toEqual([]);
	});

	it('filters neither the canvas nor its slot', () => {
		const found = offences(HOST, FILTER);
		expect(
			found,
			`a filter on the world's canvas:\n${found.join('\n')}`,
		).toEqual([]);
	});
});
