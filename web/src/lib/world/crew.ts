// The riders as the world draws them: one skinned clay-toy figure each
// (18 bones, one draw call), a flat zone ring on the road under it, a bead
// for the orbit view, and — for you alone — the trail your power leaves: a
// thin line on the road behind your wheel, the only glow in the world. A
// bunch adds the coach's chevron and the team car (#3098), and its riders
// come and go mid-ride, dithered in and out.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { tag } from './family';
import { zoneOf } from '$lib/components/zones';
import { damp } from '$lib/motion/damp';
import { effortRpm } from './figure/cadence';
import { ROAD_LIFT, yOf } from './geometry';
import { ROAD_W, across, bankOf } from './terrain/road-profile';
import { ramp } from './materials';
import { LANE, type Car } from './bunch';
import { buildGeometry } from './rider-geometry';
import { GEO } from './rider-rig';
import {
	makeRider,
	paint,
	paletteFor,
	RIDER_RAMP,
	riderMaterial,
	type RiderModel,
	type RiderPalette,
} from './rider-model';
import { pose } from './rider-pose';
import { type Route } from '$lib/road/route';
import { at, curvature, leftOf } from '$lib/road/along';
import type { SimRider } from './sim';
import type { Style } from './styles';

/**
 * The trail lies on this much road behind you and fades out along it
 * (#3663): the chase frame's bottom edge meets the road about 3.3 m behind
 * the wheel, so the fade is seen to finish.
 */
const TRAIL_M = 3;
/** About a wheel wide: a line, never a wedge or a fill. */
const TRAIL_W = 0.08;
const TRAIL_N = 24;
// Alone you keep to the right lane's middle, as on a Swiss road; the dev
// gallery's crew spreads abreast; a bunch rides its formation (bunch.ts).
const KEEP_RIGHT = -ROAD_W / 4;
/** Where the coach's chevron sits: just over a rider's helmet, over the car's roof. */
const CHEVRON_Y = 1.82;
const CHEVRON_CAR_Y = 2.2;
/** About a helmet wide on a rider: worn, not a marker on the road ahead. */
const CHEVRON_SCALE = 0.65;

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
	material: THREE.MeshToonMaterial;
	palette: RiderPalette;
	faded: boolean;
	ring: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
	shadow: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
	bead: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
	chevron: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
};

/** A joined rider whose screen has gone (#3098): their kit in greys, never a ghost's see-through. */
function greyed(pal: RiderPalette): RiderPalette {
	return Object.fromEntries(
		Object.entries(pal).map(([slot, c]) => {
			const l = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
			return [slot, new THREE.Color().setScalar(0.18 + l * 0.45)];
		}),
	) as RiderPalette;
}

/** A downward chevron, in the plane across the road: seen from the chase camera behind. */
function chevronGeometry(): THREE.BufferGeometry {
	const s = new THREE.Shape();
	s.moveTo(-0.2, 0.16);
	s.lineTo(0, 0);
	s.lineTo(0.2, 0.16);
	s.lineTo(0.2, 0.07);
	s.lineTo(0, -0.09);
	s.lineTo(-0.2, 0.07);
	s.closePath();
	return new THREE.ShapeGeometry(s);
}

/** On the road `d` metres along it and `lane` metres left of its middle, leaning with the grade. */
function placeOn(o: THREE.Object3D, route: Route, d: number, lane: number) {
	const p = at(route, d);
	const { lx, lz } = leftOf(p.heading);
	o.position.set(p.x + lx * lane, yOf(route, p.ele) + 0.12, p.z + lz * lane);
	o.rotation.set(-Math.atan(p.grade / 100) * 0.6, p.heading, 0, 'YXZ');
}

/**
 * Everyone the world draws. `neon` is the theme's structural accent: the
 * coach's chevron wears it, flat and unlit — it never glows (ADR-0005).
 */
export function makeCrew(style: Style, neon: THREE.Color) {
	const group = new THREE.Group();
	const gradient = ramp(RIDER_RAMP);
	const shadowGeo = new THREE.CircleGeometry(0.5, 20)
		.rotateX(-Math.PI / 2)
		.scale(0.9, 1, 2.1);
	const ringGeo = new THREE.RingGeometry(0.62, 0.8, 32).rotateX(-Math.PI / 2);
	const beadGeo = new THREE.SphereGeometry(1, 16, 12);
	const chevronGeo = chevronGeometry();
	const rim = new THREE.Color(style.sky.horizon).multiplyScalar(
		style.ride ? 0.45 : 0.35,
	);
	const zones = style.zones.map((z) => new THREE.Color(z));
	const chevronMaterial = () =>
		new THREE.MeshBasicMaterial({
			color: neon,
			side: THREE.DoubleSide,
			alphaHash: true,
		});

	const views = new Map<SimRider, View>();
	function viewOf(r: SimRider): View {
		const known = views.get(r);
		if (known) return known;
		const hue = hueOf(r.id);
		const palette = paletteFor(hue, style.kit);
		const material = riderMaterial(gradient, rim);
		// Dithered, never blended: a figure arriving or leaving stays one opaque draw (#3098).
		material.alphaHash = true;
		const model = makeRider(paint(buildGeometry(), palette), material);
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
		const shadow = new THREE.Mesh(
			shadowGeo,
			new THREE.MeshBasicMaterial({
				color: new THREE.Color(0, 0, 0),
				transparent: true,
				opacity: 0.28,
				depthWrite: false,
				polygonOffset: true,
				polygonOffsetFactor: -2,
				polygonOffsetUnits: -4,
			}),
		);
		const bead = new THREE.Mesh(
			beadGeo,
			new THREE.MeshBasicMaterial({
				color: new THREE.Color().setHSL(hue / 360, 0.62, 0.56),
			}),
		);
		bead.visible = false;
		const chevron = new THREE.Mesh(chevronGeo, chevronMaterial());
		chevron.position.y = CHEVRON_Y;
		chevron.scale.setScalar(CHEVRON_SCALE);
		chevron.visible = false;
		const g = new THREE.Group();
		g.add(
			tag('figures', model.mesh),
			tag('marks', shadow),
			tag('marks', ring),
			tag('marks', bead),
			tag('marks', chevron, 'chevron'),
		);
		group.add(g);
		const view = {
			group: g,
			model,
			material,
			palette,
			faded: false,
			ring,
			shadow,
			bead,
			chevron,
		};
		views.set(r, view);
		return view;
	}
	function drop(r: SimRider, v: View) {
		group.remove(v.group);
		v.model.mesh.geometry.dispose();
		v.model.mesh.skeleton.dispose();
		for (const m of [v.material, v.ring.material, v.shadow.material])
			m.dispose();
		v.bead.material.dispose();
		v.chevron.material.dispose();
		views.delete(r);
	}

	const trail = style.trail ? makeTrail(style.trail) : null;
	if (trail) group.add(tag('marks', trail.mesh, 'trail'));
	// Built the first time a bunch asks for it: a ride alone draws no car.
	let car: ReturnType<typeof makeCar> | null = null;
	const you = new THREE.Vector3();

	// Place and pose everyone; returns where you are (at chest height).
	function update(
		route: Route,
		riders: SimRider[],
		pedal: (r: SimRider) => Pedalling,
		dt: number,
		real: number,
		overview: boolean,
	): THREE.Vector3 {
		for (const [r, v] of views) if (!riders.includes(r)) drop(r, v);
		riders.forEach((r, i) => {
			const lane =
				r.lane ??
				(riders.length === 1 ? KEEP_RIGHT : 0) +
					(i - (riders.length - 1) / 2) * LANE;
			const v = viewOf(r);
			placeOn(v.group, route, r.d, lane);
			const alpha = r.alpha ?? 1;
			v.group.visible = alpha > 0;
			v.material.opacity = alpha;
			v.shadow.material.opacity = 0.28 * alpha;
			v.ring.material.opacity = 0.85 * alpha;
			if (v.faded !== !!r.faded) {
				v.faded = !!r.faded;
				paint(v.model.mesh.geometry, v.faded ? greyed(v.palette) : v.palette);
			}
			// On the model view a rider is a bead, not a giant figurine.
			v.model.mesh.visible = !overview;
			v.ring.visible = !overview && r.ring !== false;
			v.chevron.visible = !overview && !!r.coach;
			v.chevron.material.opacity = alpha;
			v.bead.visible = overview;
			v.bead.scale.setScalar(overview ? 22 : 1);
			v.bead.position.y = overview ? 22 : 0;
			v.ring.material.color.copy(zones[zoneOf(r.watts, r.ftp) - 1]);
			// Pedal only when the data says so (a rider at 0 W coasts).
			const s = pedal(r);
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
				you.set(
					v.group.position.x,
					v.group.position.y + 1.1,
					v.group.position.z,
				);
				trail?.follow(route, r.d, lane);
			}
		});
		return you;
	}

	return {
		group,
		update,
		/** The team car, where the bunch says (#3098); null puts it away. */
		drive(route: Route, at: Car | null, overview: boolean) {
			if (at && !car) {
				car = makeCar(style, gradient, chevronGeo, chevronMaterial());
				group.add(car.group);
			}
			if (!car) return;
			car.group.visible = !!at && at.alpha > 0 && !overview;
			if (!at || !car.group.visible) return;
			placeOn(car.group, route, at.d, at.lane);
			car.set(at.alpha, at.coach);
		},
		/** Your figure, as a capture measures it (#3672). */
		get you(): THREE.SkinnedMesh | null {
			for (const [r, v] of views) if (r.you) return v.model.mesh;
			return null;
		},
	};
}
export type Crew = ReturnType<typeof makeCrew>;

/**
 * The team car (#3098): a box saloon in the kit's white, its wheels in the
 * tyre's black, one draw each. It tows a rider back in, and a coach with no
 * trainer drives it — then it wears their chevron on its roof.
 * ponytail: two boxes and four drums; a modelled car when the figure is (#3673).
 */
function makeCar(
	style: Style,
	gradient: THREE.Texture,
	chevronGeo: THREE.BufferGeometry,
	chevronMat: THREE.MeshBasicMaterial,
) {
	const parts = [
		new THREE.BoxGeometry(1.8, 0.7, 4.5).translate(0, 0.65, 0),
		new THREE.BoxGeometry(1.6, 0.55, 2.3).translate(0, 1.27, -0.3),
	];
	const drum = (x: number, z: number) =>
		new THREE.CylinderGeometry(0.33, 0.33, 0.24, 14)
			.rotateZ(Math.PI / 2)
			.translate(x, 0.33, z);
	const drums = [
		drum(-0.84, 1.45),
		drum(0.84, 1.45),
		drum(-0.84, -1.45),
		drum(0.84, -1.45),
	];
	const body = mergeGeometries(parts);
	const wheels = mergeGeometries(drums);
	[...parts, ...drums].forEach((g) => g.dispose());
	const paintIn = (color: string) => {
		const m = new THREE.MeshToonMaterial({
			color: new THREE.Color(color),
			gradientMap: gradient,
			alphaHash: true,
		});
		return m;
	};
	const bodyMat = paintIn(style.kit.shoe);
	const wheelMat = paintIn(style.kit.tyre);
	const chevron = new THREE.Mesh(chevronGeo, chevronMat);
	chevron.position.y = CHEVRON_CAR_Y;
	const group = new THREE.Group();
	group.add(
		tag('figures', new THREE.Mesh(body, bodyMat), 'car'),
		tag('figures', new THREE.Mesh(wheels, wheelMat), 'car'),
		tag('marks', chevron, 'chevron'),
	);
	group.visible = false;
	return {
		group,
		set(alpha: number, coach: boolean) {
			bodyMat.opacity = wheelMat.opacity = chevronMat.opacity = alpha;
			chevron.visible = coach;
		},
	};
}

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
				// On the ribbon where your lane crosses it, banked as the ribbon is, a hair above it.
				const n = route.x.length - 1;
				const at0 = Math.round(back / route.step);
				const k = curvature(
					route,
					route.loop ? ((at0 % n) + n) % n : Math.min(Math.max(at0, 0), n),
				);
				const y =
					yOf(route, p.ele) + ROAD_LIFT + across(lane, bankOf(k)) + 0.03;
				const w = TRAIL_W / 2;
				attr.setXYZ(i * 2, x + lx * w, y, z + lz * w);
				attr.setXYZ(i * 2 + 1, x - lx * w, y, z - lz * w);
			}
			attr.needsUpdate = true;
		},
	};
}
