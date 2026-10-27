import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { code } from '$lib/source-scan.test-helper';

/**
 * A phone in a session never drew the world (#4218): the solo ride's phone
 * band (#3676) checked `world.band`, the session's phone layout never took a
 * world at all, so the World control's Full did nothing there.
 */
const read = (file: string) =>
	code(readFileSync(join(import.meta.dirname, file), 'utf8'));
const training = read('Training.svelte');
const phone = read('TrainingPhone.svelte');

describe('a phone in a session (#4218)', () => {
	it('is handed the world where this device draws it as a band, and the view switch', () => {
		expect(training).toMatch(
			/<TrainingPhone[^>]*band=\{world\.band && channel\.ridden \? road : undefined\}/,
		);
		expect(training).toMatch(
			/<TrainingPhone[^>]*viewSwitch=\{channel\.ridden \? phoneSwitch : undefined\}/,
		);
		expect(training).toMatch(
			/\{#snippet phoneSwitch\(\)\}\s*<ViewSwitch \{world\} drawn=\{world\.band && !!channel\.ridden\} \/>/,
		);
	});

	it('draws it in slot 2’s place, the band a solo phone ride draws', () => {
		expect(phone).toMatch(
			/data-dock="world"[^>]*style="height:\{PHONE_WORLD_PX\}px"[^>]*>\s*\{@render band\(\)\}/,
		);
		expect(phone).toContain('{@render viewSwitch?.()}');
	});
});
