// The next blocks painted on the road (#3101, v2-erg): a bar across the
// asphalt where each block starts with its words beyond it, chevrons leading
// to it over its last 100 m, and a sprint's banner across the road from 1 km
// out. Road paint, never live data: in the road line's colour, lit by the sky
// as the road's own paint is (ADR-0072), and nothing glows.
import * as THREE from 'three';
import { GATES, type PaintedGate } from '$lib/road/gates';
import { at, curvature } from '$lib/road/along';
import { type Route } from '$lib/road/route';
import { disposeTree } from './dispose';
import { tag } from './family';
import { FONT, archOnRoad, paintedTexture } from './furniture';
import { ROAD_LIFT, yOf } from './geometry';
import type { Style } from './styles';
import { bankOf, ROAD_W } from './terrain/road-profile';

/** The issue's numbers: chevrons over a block's last 100 m, a sprint's banner from 1 km. */
export const CHEVRONS_M = 100;
export const BANNER_M = 1000;
/** What a sprint's banner says. */
export const SPRINT = 'SPRINT';
// ponytail: a look, not a rule. A chevron every 20 m; the words stretched
// along the road as road paint is, so a rider's low eye reads them whole.
const CHEVRON_EVERY_M = 20;
const CHEVRONS = CHEVRONS_M / CHEVRON_EVERY_M;
const ACROSS = ROAD_W - 0.6;
const ALONG = 10;
const W = 1024;
const H = 160;
/** The bar's share of the paint's length, at its near edge: where the block starts. */
const BAR = 0.1;

function draw(
	x: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D,
	words: string,
	paint: string,
) {
	x.fillStyle = paint;
	x.fillRect(0, H * (1 - BAR), W, H * BAR);
	x.textAlign = 'center';
	x.textBaseline = 'middle';
	let size = 120;
	x.font = `bold ${size}px "Chakra Petch", ${FONT}`;
	const wide = x.measureText(words).width;
	if (wide > W * 0.94) {
		size = Math.floor((size * W * 0.94) / wide);
		x.font = `bold ${size}px "Chakra Petch", ${FONT}`;
	}
	x.fillText(words, W / 2, H * 0.42);
}

/** A chevron flat on the road, its point up the road (+y before it is laid down). */
const CHEVRON_D = 2.4;
function chevron(): THREE.BufferGeometry {
	const w = 1.6;
	const d = CHEVRON_D;
	const t = 0.55;
	const s = new THREE.Shape();
	s.moveTo(-w / 2, 0);
	s.lineTo(0, d);
	s.lineTo(w / 2, 0);
	s.lineTo(w / 2, -t);
	s.lineTo(0, d - t);
	s.lineTo(-w / 2, -t);
	s.closePath();
	return new THREE.ShapeGeometry(s).rotateX(-Math.PI / 2);
}

/**
 * Where paint `long` metres up the road from `m` lies: on the asphalt from
 * its near edge, pitched up the road's grade so its far end is not buried
 * under a climb, banked as the ribbon is, and reading up the road.
 */
function lay(route: Route, o: THREE.Object3D, m: number, long: number) {
	const p = at(route, m);
	const rise = yOf(route, at(route, m + long).ele) - yOf(route, p.ele);
	const n = route.x.length - 1;
	const bank = bankOf(
		curvature(route, Math.min(Math.max(Math.round(m / route.step), 0), n)),
	);
	o.position.set(p.x, yOf(route, p.ele) + ROAD_LIFT + 0.03, p.z);
	o.rotation.set(Math.atan2(rise, long), p.heading + Math.PI, bank, 'YXZ');
}

export function makeGates(route: Route, style: Style) {
	const group = new THREE.Group();
	const paint = style.road.line;
	// Laid on the asphalt, never fighting it for the same depth; Lambert, as the road's paint is.
	const flat = (o: THREE.MeshLambertMaterialParameters) =>
		new THREE.MeshLambertMaterial({
			depthWrite: false,
			polygonOffset: true,
			polygonOffsetFactor: -2,
			...o,
		});
	const chevrons = new THREE.InstancedMesh(
		chevron(),
		flat({ color: paint }),
		GATES * CHEVRONS,
	);
	chevrons.count = 0;
	group.add(tag('road', chevrons, 'chevrons'));
	// The words from their near edge, so the bar lies on the gate's metre.
	const plane = new THREE.PlaneGeometry(ACROSS, ALONG)
		.translate(0, ALONG / 2, 0)
		.rotateX(-Math.PI / 2);
	const words = Array.from({ length: GATES }, () => {
		// Each its own words, painted in the road line on a clear ground.
		const mesh = new THREE.Mesh(plane, flat({ transparent: true }));
		mesh.visible = false;
		group.add(tag('road', mesh, 'gate'));
		return mesh;
	});
	const painted = new Map<string, THREE.CanvasTexture<unknown>>();
	let banner: { index: number; m: number; mesh: THREE.Group } | null = null;
	let shown: readonly PaintedGate[] = [];
	const spot = new THREE.Object3D();

	function texture(text: string) {
		let tex = painted.get(text);
		if (!tex) {
			tex = paintedTexture(W, H, (x) => draw(x, text, paint));
			painted.set(text, tex);
		}
		return tex;
	}

	function dropBanner() {
		if (!banner) return;
		group.remove(banner.mesh);
		disposeTree(banner.mesh);
		banner = null;
	}

	function repaint(gates: readonly PaintedGate[]) {
		let k = 0;
		words.forEach((mesh, i) => {
			const g = gates[i];
			mesh.visible = !!g;
			if (!g) return;
			lay(route, mesh, g.m, ALONG);
			mesh.userData.words = g.words;
			const mat = mesh.material as THREE.MeshLambertMaterial;
			const tex = texture(g.words);
			if (mat.map !== tex) {
				mat.map = tex;
				mat.needsUpdate = true;
			}
			for (let c = 1; c <= CHEVRONS; c++) {
				lay(route, spot, g.m - c * CHEVRON_EVERY_M, CHEVRON_D);
				spot.updateMatrix();
				chevrons.setMatrixAt(k++, spot.matrix);
			}
		});
		chevrons.count = k;
		chevrons.instanceMatrix.needsUpdate = true;
		chevrons.computeBoundingSphere();
		// Words no gate paints any more are let go.
		const keep = new Set(gates.map((g) => g.words));
		for (const [text, tex] of painted)
			if (!keep.has(text)) {
				tex.dispose();
				painted.delete(text);
			}
	}

	return {
		group,
		/**
		 * This frame's gates (the same array until the ride works them out
		 * again) and your metre: painted where each block starts, and a
		 * sprint's banner while you are within 1 km of it.
		 */
		update(gates: readonly PaintedGate[], youM: number) {
			if (gates !== shown) {
				shown = gates;
				repaint(gates.slice(0, GATES));
			}
			const sprint = gates.find(
				(g) => g.sprint && g.m > youM && g.m - youM <= BANNER_M,
			);
			if (!sprint) return dropBanner();
			if (banner?.index !== sprint.index) {
				dropBanner();
				const mesh = tag(
					'dressing',
					archOnRoad(route, sprint.m, SPRINT, style),
					'arch',
				);
				mesh.userData.words = SPRINT;
				group.add(mesh);
				banner = { index: sprint.index, m: sprint.m, mesh };
			} else if (banner.m !== sprint.m) {
				// The plan ridden again moved it a little: where archOnRoad stands one.
				const p = at(route, sprint.m);
				banner.mesh.position.set(p.x, yOf(route, p.ele) + 0.1, p.z);
				banner.mesh.rotation.y =
					Math.atan2(-Math.sin(p.heading), -Math.cos(p.heading)) + Math.PI;
				banner.m = sprint.m;
			}
		},
	};
}
export type GatesLayer = ReturnType<typeof makeGates>;
