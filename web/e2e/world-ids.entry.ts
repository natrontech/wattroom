import * as THREE from 'three';
import { toRoute } from '../src/lib/road/route';
import { pageGrids } from '../src/lib/world/chunks/grids';
import { compose, type Composed } from '../src/lib/world/compose';
import { syntheticPoints } from '../src/lib/world/synthetic';
import { generate } from '../src/lib/world/world';
import { devCrew } from '../src/routes/(app)/dev/world/crew';
import { STYLES } from '../src/routes/(app)/dev/world/styles';
import { idChecks, type Pop } from './world-ids';

/**
 * What world-ids.spec.ts bundles into a page: the synthetic pass loop's
 * world, composed as /dev/world composes it with every chunk built on the
 * page, and the GPU checks on it (#3222). Nothing runs a loop: each check
 * holds or steps the world itself.
 */
const W = 1440;
const H = 900;
const FTP = 250;
const WATTS = 200;
/** Frames ridden before a pop is looked for: the chase camera settles behind you. */
const SETTLE = 30;

const route = toRoute(syntheticPoints());
const world = generate(route);
const renderer = new THREE.WebGLRenderer({ antialias: false });
renderer.setSize(W, H, false);
document.body.append(renderer.domElement);

let composed: Composed | null = null;
let checks: ReturnType<typeof idChecks> | null = null;

/** You alone, held at metre `m`; or, with `m` null, the gallery's crew riding from the start. */
function place(m: number | null) {
	checks?.dispose();
	composed?.dispose();
	composed = compose(
		{
			route,
			world,
			// /dev/world's first look: the ride's own is painted from app.css, which this page has none of.
			style: STYLES[0],
			ftp: FTP,
			watts: WATTS,
			riders: devCrew(WATTS, FTP, null, m !== null),
			grids: pageGrids(world),
			moment: m === null ? undefined : { m, p: 0.5 },
		},
		null,
	);
	composed.camera.aspect = W / H;
	composed.camera.updateProjectionMatrix();
	if (m === null) for (let k = 0; k < SETTLE; k++) composed.advanceBy(1 / 30);
	composed.look();
	checks = idChecks(renderer, composed);
	return checks;
}

export const length = (): number => route.length;
export const mask = (m: number) => place(m).mask();
export const flicker = (m: number, mm: number): number => place(m).flicker(mm);
export const ride = (frames: number, minPx: number): Pop[] =>
	place(null).ride(frames, minPx);
