// The riders as the world draws them: one skinned clay-toy figure each
// (18 bones, one draw call), a flat zone ring on the road under it, a bead
// for the orbit view, and — for you alone — the trail your power leaves: a
// thin line on the road behind your wheel, the only glow in the world.
import * as THREE from 'three';
import { tag } from './family';
import { zoneOf } from '$lib/components/zones';
import { damp } from '$lib/motion/damp';
import { effortRpm } from './figure/cadence';
import { yOf } from './geometry';
import { ramp } from './materials';
import { buildGeometry } from './rider-geometry';
import { GEO } from './rider-rig';
import {
	makeRider,
	paint,
	paletteFor,
	RIDER_RAMP,
	riderMaterial,
	type RiderModel,
} from './rider-model';
import { pose } from './rider-pose';
import { type Route } from '$lib/road/route';
import { at, leftOf } from '$lib/road/along';
import type { SimRider } from './sim';
import type { Style } from './styles';

/** The trail lies on this much road behind you, and fades out along it (#3663). */
const TRAIL_M = 12;
/** About a wheel wide: a line, never a wedge or a fill. */
const TRAIL_W = 0.08;
const TRAIL_N = 24;
const LANE = 0.9; // metres between riders abreast

// Identity is a hue from the rider's id, never the watt hue (ADR-0005: watt
// is live data). Live power shows as the flat zone ring; the only glow is
// your own trail.
export function hueOf(id: string): number {
	let h = 2166136261;
	for (const ch of id) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
	const u = ((h >>> 0) % 1000) / 1000;
	return (20 + u * 280) % 360; // skips 300°–20°, the watt magenta's neighbourhood
}

// What a rider's legs are doing, kept across style changes.
export type Pedalling = { crank: number; wheel: number; stand: number };

type View = {
	group: THREE.Group;
	model: RiderModel;
	ring: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
	bead: THREE.Mesh;
};

export function makeCrew(riders: SimRider[], style: Style) {
	const group = new THREE.Group();
	const gradient = ramp(RIDER_RAMP);
	const shadowGeo = new THREE.CircleGeometry(0.5, 20)
		.rotateX(-Math.PI / 2)
		.scale(0.9, 1, 2.1);
	const shadowMat = new THREE.MeshBasicMaterial({
		color: new THREE.Color(0, 0, 0),
		transparent: true,
		opacity: 0.28,
		depthWrite: false,
		polygonOffset: true,
		polygonOffsetFactor: -2,
		polygonOffsetUnits: -4,
	});
	const ringGeo = new THREE.RingGeometry(0.62, 0.8, 32).rotateX(-Math.PI / 2);
	const beadGeo = new THREE.SphereGeometry(1, 16, 12);
	const rim = new THREE.Color(style.sky.horizon).multiplyScalar(
		style.ride ? 0.45 : 0.35,
	);
	const zones = style.zones.map((z) => new THREE.Color(z));

	const views: View[] = riders.map((r) => {
		const hue = hueOf(r.id);
		const model = makeRider(
			paint(buildGeometry(), paletteFor(hue, style.kit)),
			riderMaterial(gradient, rim),
		);
		model.mesh.rotation.y = -Math.PI / 2; // the model's +X forward becomes the world's heading
		const ring = new THREE.Mesh(
			ringGeo,
			new THREE.MeshBasicMaterial({
				color: zones[0],
				transparent: true,
				opacity: 0.85,
				depthWrite: false,
				polygonOffset: true,
				polygonOffsetFactor: -3,
				polygonOffsetUnits: -6,
			}),
		);
		ring.position.y = 0.16; // above a banked road, never half-buried
		const bead = new THREE.Mesh(
			beadGeo,
			new THREE.MeshBasicMaterial({
				color: new THREE.Color().setHSL(hue / 360, 0.62, 0.56),
			}),
		);
		bead.visible = false;
		const g = new THREE.Group();
		g.add(
			tag('figures', model.mesh),
			tag('marks', new THREE.Mesh(shadowGeo, shadowMat)),
			tag('marks', ring),
			tag('marks', bead),
		);
		group.add(g);
		return { group: g, model, ring, bead };
	});

	const trail = style.trail ? makeTrail(style.trail) : null;
	if (trail) group.add(tag('marks', trail.mesh, 'trail'));
	const you = new THREE.Vector3();

	// Place and pose everyone; returns where you are (at chest height).
	function update(
		route: Route,
		pedal: Pedalling[],
		dt: number,
		real: number,
		overview: boolean,
	): THREE.Vector3 {
		riders.forEach((r, i) => {
			const p = at(route, r.d);
			const { lx, lz } = leftOf(p.heading);
			const lane = (i - (riders.length - 1) / 2) * LANE;
			const x = p.x + lx * lane;
			const z = p.z + lz * lane;
			const y = yOf(route, p.ele) + 0.12;
			const v = views[i];
			v.group.position.set(x, y, z);
			v.group.rotation.set(
				-Math.atan(p.grade / 100) * 0.6,
				p.heading,
				0,
				'YXZ',
			);
			// On the model view a rider is a bead, not a giant figurine.
			v.model.mesh.visible = !overview;
			v.ring.visible = !overview;
			v.bead.visible = overview;
			v.bead.scale.setScalar(overview ? 22 : 1);
			v.bead.position.y = overview ? 22 : 0;
			v.ring.material.color.copy(zones[zoneOf(r.watts, r.ftp) - 1]);
			// Pedal only when the data says so (a rider at 0 W coasts).
			const s = pedal[i];
			const rpm = r.watts < 5 ? 0 : effortRpm(r.watts, r.ftp);
			s.crank += (rpm / 60) * Math.PI * 2 * dt;
			s.wheel += (r.v / GEO.wheelR) * dt;
			// Stand for a sprint with hysteresis: up above 1.6 × FTP, down below 1.3 ×.
			const target =
				r.watts > 1.6 * r.ftp
					? 1
					: r.watts < 1.3 * r.ftp
						? 0
						: s.stand > 0.5
							? 1
							: 0;
			s.stand += (target - s.stand) * damp(0.25, real);
			pose(v.model, {
				crank: s.crank,
				wheel: s.wheel,
				stand: s.stand,
				rock: s.stand * 0.12 * Math.sin(s.crank),
				rockBody: 0.02 + s.stand * 0.03,
				nod: 0.02 * Math.sin(s.crank * 2),
			});
			if (r.you) {
				you.set(x, y + 1.1, z);
				trail?.follow(route, r.d, lane);
			}
		});
		return you;
	}

	return { group, update };
}
export type Crew = ReturnType<typeof makeCrew>;

// Your trail: a thin line on the road from your wheel back TRAIL_M metres,
// additive and unfogged, fading out along its length.
function makeTrail(color: string) {
	const rows = TRAIL_N + 1;
	const pos = new Float32Array(rows * 2 * 3);
	const col = new Float32Array(rows * 2 * 4);
	const c = new THREE.Color(color);
	for (let i = 0; i < rows; i++) {
		const a = (1 - i / TRAIL_N) * 0.85;
		col.set([c.r, c.g, c.b, a, c.r, c.g, c.b, a], i * 8);
	}
	const idx: number[] = [];
	for (let i = 0; i < TRAIL_N; i++)
		idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
	const g = new THREE.BufferGeometry();
	const attr = new THREE.BufferAttribute(pos, 3);
	g.setAttribute('position', attr);
	g.setAttribute('color', new THREE.BufferAttribute(col, 4));
	g.setIndex(idx);
	const mesh = new THREE.Mesh(
		g,
		new THREE.MeshBasicMaterial({
			vertexColors: true,
			transparent: true,
			blending: THREE.AdditiveBlending,
			depthWrite: false,
			side: THREE.DoubleSide,
			fog: false,
		}),
	);
	mesh.frustumCulled = false;
	return {
		mesh,
		/** Lays the line on the road behind `d`, in the lane you ride. */
		follow(route: Route, d: number, lane: number) {
			for (let i = 0; i < rows; i++) {
				const back = d - (i / TRAIL_N) * TRAIL_M;
				const p = at(route, route.loop ? back : Math.max(0, back));
				const { lx, lz } = leftOf(p.heading);
				const x = p.x + lx * lane;
				const z = p.z + lz * lane;
				const y = yOf(route, p.ele) + 0.14; // on the ribbon, a hair above it
				const w = TRAIL_W / 2;
				attr.setXYZ(i * 2, x + lx * w, y, z + lz * w);
				attr.setXYZ(i * 2 + 1, x - lx * w, y, z - lz * w);
			}
			attr.needsUpdate = true;
		},
	};
}
