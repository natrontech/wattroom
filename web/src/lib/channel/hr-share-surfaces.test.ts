import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { code, FILES } from '$lib/source-scan.test-helper';

/**
 * ADR-0008 makes the see-and-stop line a requirement, and it has been lost
 * once already without a test noticing (#2804): #383 split the places and
 * left the component holding it with no caller, and #539 deleted the file
 * as unreferenced. So the surfaces are found rather than listed — any
 * voice-channel screen that draws the rider's own numbers — and a new one
 * cannot be born without it.
 */
const SRC = join(import.meta.dirname, '../..');
const read = (file: string) => code(readFileSync(join(SRC, file), 'utf8'));

const riding = FILES.filter((file) => file.endsWith('.svelte')).filter(
	(file) => {
		const source = read(file);
		return source.includes('<SecondaryRow') && source.includes('useChannel()');
	},
);

describe('where heart rate reaches the call (#2804)', () => {
	it('finds the riding surfaces', () => {
		expect(riding).toEqual(
			expect.arrayContaining([
				'lib/session/Training.svelte',
				'lib/session/TrainingPhone.svelte',
				'lib/ride/FreeRide.svelte',
			]),
		);
	});

	it.each(riding)('%s says whether it is shared', (file) => {
		expect(read(file)).toContain('<HrShare');
	});

	it('the Lounge says so too: its tiles show everyone the bpm', () => {
		expect(read('lib/channel/Lounge.svelte')).toContain('<HrShare');
	});

	it('the line reads the ride and sets the flag the ride sends by', () => {
		const line = read('lib/channel/HrShare.svelte');
		expect(line).toContain('ride.hrSource');
		expect(line).toContain('profile.current.shareHr');
		expect(line).toContain('profile.update({ shareHr');
	});
});
