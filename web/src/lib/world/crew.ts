// The riders as the world draws them: one skinned clay-toy figure each
// (18 bones, one draw call), a flat zone ring on the road under it, a bead
// for the orbit view, and — for you alone — the trail your power leaves.
import * as THREE from 'three';
import { zoneOf } from '$lib/components/zones';
import { damp } from './damp';
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

const TRAIL = 90; // samples, one every 0.2 s of ride time → ~18 s of light behind you
const SAMPLE = 0.2;
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

// The cadence a rider without a cadence sensor pedals at, from their effort
// (docs/SPEC.md "Rider animation": the jukebox's effort tiers).
export function effortRpm(watts: number, ftp: number): number {
	const r = watts / ftp;
	return r <= 0.55 ? 80 : r <= 0.75 ? 85 : r <= 0.9 ? 90 : 95;
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
		g.add(model.mesh, new THREE.Mesh(shadowGeo, shadowMat), ring, bead);
		group.add(g);
		return { group: g, model, ring, bead };
	});

	const trail = style.trail ? makeTrail(style.trail) : null;
	if (trail) group.add(trail.mesh);
	let sinceSample = 0;
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
			if (r.you) you.set(x, y + 1.1, z);
		});
		if (trail) {
			sinceSample += dt;
			trail.follow(you, sinceSample >= SAMPLE);
			if (sinceSample >= SAMPLE) sinceSample = 0;
		}
		return you;
	}

	return { group, update };
}
export type Crew = ReturnType<typeof makeCrew>;

// A ribbon of light behind you: additive, unfogged, fading along its length.
function makeTrail(color: string) {
	const pos = new Float32Array(TRAIL * 2 * 3);
	const col = new Float32Array(TRAIL * 2 * 4);
	const c = new THREE.Color(color);
	for (let i = 0; i < TRAIL; i++)
		col.set([c.r, c.g, c.b, (1 - i / TRAIL) * 0.85, c.r, c.g, c.b, 0], i * 8);
	const idx: number[] = [];
	for (let i = 0; i < TRAIL - 1; i++)
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
	const hist: THREE.Vector3[] = [];
	return {
		mesh,
		follow(you: THREE.Vector3, sample: boolean) {
			const foot = you.clone().setY(you.y - 1.05);
			if (sample || hist.length === 0) {
				hist.unshift(foot);
				if (hist.length > TRAIL) hist.pop();
			} else hist[0].copy(foot);
			for (let j = 0; j < TRAIL; j++) {
				const h = hist[Math.min(j, hist.length - 1)];
				attr.setXYZ(j * 2, h.x, h.y + 0.02, h.z);
				attr.setXYZ(j * 2 + 1, h.x, h.y + 0.9, h.z);
			}
			attr.needsUpdate = true;
		},
	};
}
