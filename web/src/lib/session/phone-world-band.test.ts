import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { code } from '$lib/source-scan.test-helper';

/**
 * A phone in a session never drew the world (#4218): the solo ride's phone
 * band (#3676) checked `world.band`, the session's phone layout never took a
 * world at all, so the World control's Full did nothing there. Since #4233
 * the session's phone is the solo phone layout, RidingSurface's own branch.
 */
const read = (file: string) =>
	code(readFileSync(join(import.meta.dirname, file), 'utf8'));
const training = read('Training.svelte');
const surface = read('RidingSurface.svelte');
const controls = read('PhoneSessionControls.svelte');

describe('a phone in a session (#4218, #4233)', () => {
	it('rides the riding surface, no layout of its own', () => {
		expect(training).not.toMatch(/\{:else if device\.narrow\}/);
		expect(training).toMatch(
			/world=\{phone\s*\?\s*world\.band && channel\.ridden\s*\?\s*road\s*:\s*undefined/,
		);
	});

	it('draws the world in slot 2’s place, the band a solo phone ride draws', () => {
		expect(surface).toMatch(
			/data-dock="world"[^>]*style="height:\{PHONE_WORLD_PX\}px"[^>]*>\s*\{@render world\(\)\}/,
		);
	});

	it('carries the view switch in its controls, 3D where the band draws', () => {
		expect(controls).toMatch(
			/<ViewSwitch\s*\{world\}\s*drawn=\{world\.band && !!channel\.ridden\}/,
		);
		expect(training).toMatch(
			/controls=\{phone \? phoneControls : worldControls\}/,
		);
	});
});
