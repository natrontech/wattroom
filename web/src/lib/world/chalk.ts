// The roadside's chalk on the road (#3029, ADR-0064): Jan's six stamps,
// painted flat on the asphalt where the hub put them and gone once the bunch
// rides over them. Scenery, never live data: unlit, and nothing glows.
import * as THREE from 'three';
import type { Chalk } from '$lib/channel/bunch-view';
import type { RoadsideStamp } from '$lib/protocol';
import { at } from '$lib/road/along';
import { type Route } from '$lib/road/route';
import { disposeTree } from './dispose';
import { tag } from './family';
import { FONT, paintedTexture } from './furniture';
import { ROAD_LIFT, yOf } from './geometry';
import { ROAD_W } from './terrain/road-profile';

// ponytail: a look, not a rule — chalk across most of the road and stretched
// along it, as road paint is, so it reads from a rider's low eye; tune it on
// a climb.
const ACROSS = ROAD_W * 0.8;
const ALONG = ACROSS * 2;
const W = 256;
const H = 128;
const CHALK = '#f1ede4';

/** The words a stamp chalks; the glyph stamps draw a shape instead. */
const WORDS: Partial<Record<RoadsideStamp, string>> = {
	allez: 'ALLEZ',
	hopp: 'HOPP',
};

function draw(
	x: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D,
	stamp: RoadsideStamp,
	letter: string,
) {
	x.fillStyle = CHALK;
	x.strokeStyle = CHALK;
	x.lineWidth = 14;
	x.lineJoin = 'round';
	x.textAlign = 'center';
	x.textBaseline = 'middle';
	const word = WORDS[stamp] ?? (stamp === 'initial' ? letter : '');
	if (word) {
		x.font = `bold ${word.length > 1 ? 84 : 112}px ${FONT}`;
		x.fillText(word, W / 2, H / 2 + 6);
		return;
	}
	x.beginPath();
	if (stamp === 'arrow') {
		// Up the road: the way the riders go.
		x.moveTo(W / 2, 10);
		x.lineTo(W / 2 + 44, 58);
		x.lineTo(W / 2 + 16, 58);
		x.lineTo(W / 2 + 16, 118);
		x.lineTo(W / 2 - 16, 118);
		x.lineTo(W / 2 - 16, 58);
		x.lineTo(W / 2 - 44, 58);
		x.closePath();
		x.fill();
	} else if (stamp === 'heart') {
		x.moveTo(W / 2, 116);
		x.bezierCurveTo(W / 2 - 78, 60, W / 2 - 54, 6, W / 2, 34);
		x.bezierCurveTo(W / 2 + 54, 6, W / 2 + 78, 60, W / 2, 116);
		x.fill();
	} else if (stamp === 'cowbell') {
		x.moveTo(W / 2 - 26, 22);
		x.lineTo(W / 2 + 26, 22);
		x.lineTo(W / 2 + 44, 100);
		x.lineTo(W / 2 - 44, 100);
		x.closePath();
		x.stroke();
		x.beginPath();
		x.arc(W / 2, 112, 10, 0, Math.PI * 2);
		x.fill();
	}
}

/** One stamp, flat on the road at its metre, reading up the road. */
function stampMesh(route: Route, c: Chalk): THREE.Mesh {
	const p = at(route, c.u);
	const mesh = new THREE.Mesh(
		new THREE.PlaneGeometry(ACROSS, ALONG).rotateX(-Math.PI / 2),
		new THREE.MeshBasicMaterial({
			map: paintedTexture(W, H, (x) => draw(x, c.stamp, c.letter)),
			transparent: true,
			depthWrite: false,
			// Laid on the asphalt, never fighting it for the same depth.
			polygonOffset: true,
			polygonOffsetFactor: -2,
		}),
	);
	// On the asphalt, which rides ROAD_LIFT over the centre line, a hair above it.
	mesh.position.set(p.x, yOf(route, p.ele) + ROAD_LIFT + 0.03, p.z);
	// The texture's top points up the road (heading is atan2(dx, dz)), so it
	// reads the right way up to the riders coming at it.
	mesh.rotation.y = p.heading + Math.PI;
	mesh.userData.stamp = c.stamp;
	return tag('dressing', mesh, 'chalk');
}

export function makeChalk(route: Route) {
	const group = new THREE.Group();
	const drawn = new Map<string, THREE.Mesh>();
	return {
		group,
		/** The chalk on this tick's road: new stamps painted, ridden-over ones gone. */
		update(chalk: readonly Chalk[]) {
			const keep = new Set(chalk.map((c) => c.key));
			for (const [key, mesh] of drawn)
				if (!keep.has(key)) {
					group.remove(mesh);
					disposeTree(mesh);
					drawn.delete(key);
				}
			for (const c of chalk)
				if (!drawn.has(c.key)) {
					const mesh = stampMesh(route, c);
					group.add(mesh);
					drawn.set(c.key, mesh);
				}
		},
	};
}
export type ChalkLayer = ReturnType<typeof makeChalk>;
