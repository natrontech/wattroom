// The world's screenshots on the landing and in the README: `make site-screens`.
//
// They are design shots (web/e2e/design-shots.spec.ts), taken on the
// synthetic fixtures the design check rides: the hairpin road in the open
// South Atlantic (TARGETS G10) and the dev riders Designer and Design
// Partner, with no camera on. `make site-screens` takes the surfaces below
// in the dark scheme and runs this on the folder it wrote, so the site, the
// README and the design check show one app.
//
// Writes web/static/screens/<name>.webp, 1440 × 900 unless cropped.
import { existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { toWebp } from './webp.mjs';

/** Site name: [design shot, crop?]. The surfaces `make site-screens` names take every one. */
export const SCREENS = {
	'world-crew': ['ride-session-road'],
	'world-blocks': ['ride-road-world-gate'],
	'world-ghost': ['ride-free-road-ghost'],
	'world-sprint': ['ride-session-sprint-live'],
	'race-picker': ['picker-race-door'],
	'phone-remote': ['ride-phone-remote'],
	'workout-flat': ['ride-workout-flat'],
};

const dir = process.argv[2];
if (!dir) {
	console.error('usage: node scripts/site-screens.mjs <design-shots dir>/dark');
	process.exit(1);
}
const OUT = fileURLToPath(new URL('../static/screens/', import.meta.url));

let missing = 0;
for (const [name, [shot, crop]] of Object.entries(SCREENS)) {
	const png = join(resolve(dir), `${shot}.png`);
	if (!existsSync(png)) {
		console.error(`${shot}.png is not in ${dir}`);
		missing++;
		continue;
	}
	const webp = join(OUT, `${name}.webp`);
	toWebp(png, webp, { crop });
	console.log(`${name}.webp  ${Math.round(statSync(webp).size / 1024)} KB`);
}
process.exit(missing ? 1 : 0);
