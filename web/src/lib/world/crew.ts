// The riders as the world draws them: ADR-0073's figure on its bike, one
// skinned draw each (#3070), posed every frame by its animator from the
// rider's watts, speed and grade (#3071) — near you in full detail, further
// off in the lighter one; a flat zone ring on the road under it, a bead for
// the orbit view, and — for you alone — the trail your power leaves: a thin
// line on the road behind your wheel, the only glow in the world. A bunch
// adds the coach's chevron and the team car (#3098), and its riders come and
// go mid-ride, dithered in and out.
import * as THREE from 'three';
import { tag } from './family';
import { zoneOf } from '$lib/components/zones';
import { RiderAnimator, type RideInput } from './figure/animator';
import { buildFigure, paint, type Figure, type Palette } from './figure/figure';
import {
	figureMaterial,
	TOON_BANDS,
	type FigureMaterial,
} from './figure/material';
import { pose } from './figure/pose';
import { fnv, seededLoadout } from './loadout';
import { outfitOf, type Outfit } from './outfit';
import { collides, type Viewer } from '$lib/wardrobe/guard';
import { DEFAULT_DARK_ID, themeById } from '$lib/themes';
import { yOf } from './geometry';
import { ROAD_W } from './terrain/road-profile';
import { chevronGeometry, makeCar } from './team-car';
import { thumbGeometry } from './cheer';
import { makeTrail } from './trail';
import { ramp } from './materials';
import { LANE, type Car } from './bunch';
import { type Route } from '$lib/road/route';
import { at, leftOf } from '$lib/road/along';
import type { SimRider } from './sim';
import type { Style } from './styles';

// Alone you keep to the right lane's middle, as on a Swiss road; the dev
// gallery's crew spreads abreast; a bunch rides its formation (bunch.ts).
const KEEP_RIGHT = -ROAD_W / 4;
/** Where the coach's chevron sits: just over a rider's helmet. */
const CHEVRON_Y = 1.82;
/** About a helmet wide on a rider: worn, not a marker on the road ahead. */
const CHEVRON_SCALE = 0.65;
/** A cheer's thumb (#3116): over the helmet, clear of a coach's chevron. */
const THUMB_Y = 2.22;
/** Riders drawn in full detail, you among them (docs/SPEC.md "The world"); the rest take LOD1. */
const NEAR = 3;
/** Seconds between choosing who is near: a swap rebuilds a figure. */
const RANK_EVERY = 1;
/** Seconds a new figure rides before it is first drawn, so it arrives in its riding posture. */
const SETTLE_S = 2;
const SETTLE_DT = 1 / 30;

// Identity is a hue from the rider's id, never the watt hue (ADR-0005: watt
// is live data). Live power shows as the flat zone ring; the only glow is
// your own trail.
export function hueOf(id: string): number {
	const u = (fnv(id) % 1000) / 1000;
	return (20 + u * 280) % 360; // skips 300°–20°, the watt magenta's neighbourhood
}

// Where a rider's cranks stand, kept across style changes.
export type Pedalling = { crank: number };

type View = {
	group: THREE.Group;
	figure: Figure;
	lod: 0 | 1;
	anim: RiderAnimator;
	material: FigureMaterial;
	outfit: Outfit;
	/** The loadout's name in the figure cache. */
	look: string;
	faded: boolean;
	ring: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
	shadow: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
	bead: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
	chevron: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
	thumb: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
	light: THREE.Mesh;
};

/** A joined rider whose screen has gone (#3098): their kit in greys, never a ghost's see-through. */
const grey = (c: THREE.Color) =>
	new THREE.Color().setScalar(
		0.18 + (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) * 0.45,
	);
function greyed(pal: Palette): Palette {
	return Object.fromEntries(
		Object.entries(pal).map(([slot, c]) => [slot, grey(c)]),
	) as Palette;
}

/** What the animator reads from a rider on the road. */
const inputOf = (r: SimRider, route: Route): RideInput => ({
	power: r.watts,
	ftp: r.ftp,
	speed: r.v,
	grade: at(route, r.d).grade,
});

/** On the road `d` metres along it and `lane` metres left of its middle, leaning with the grade. */
export function placeOn(
	o: THREE.Object3D,
	route: Route,
	d: number,
	lane: number,
) {
	const p = at(route, d);
	const { lx, lz } = leftOf(p.heading);
	o.position.set(p.x + lx * lane, yOf(route, p.ele) + 0.12, p.z + lz * lane);
	o.rotation.set(-Math.atan(p.grade / 100) * 0.6, p.heading, 0, 'YXZ');
}

/**
 * Everyone the world draws. `neon` is the theme's structural accent: the
 * coach's chevron wears it, flat and unlit — it never glows (ADR-0005).
 * Every kit colour is guarded for whoever looks, whose live data is the
 * look's trail and zones: the theme's, on a ride.
 */
export function makeCrew(style: Style, neon: THREE.Color) {
	const hex = (c: string) => `#${new THREE.Color(c).getHexString()}`;
	const viewer: Viewer = {
		watt: hex(style.trail ?? themeById(DEFAULT_DARK_ID)!.tokens.watt),
		zones: style.zones.map(hex),
	};
	const group = new THREE.Group();
	const gradient = ramp(TOON_BANDS.map((b) => b / 255));
	// A sun's contact shadow grounds each rider; under the sky alone nothing casts one (ADR-0072).
	const shadowed = style.sun.elevation >= 0;
	const shadowGeo = new THREE.CircleGeometry(0.5, 20)
		.rotateX(-Math.PI / 2)
		.scale(0.9, 1, 2.1);
	const ringGeo = new THREE.RingGeometry(0.62, 0.8, 32).rotateX(-Math.PI / 2);
	const beadGeo = new THREE.SphereGeometry(1, 16, 12);
	const chevronGeo = chevronGeometry();
	const thumbGeo = thumbGeometry(
		new THREE.Color(style.kit.shoe),
		new THREE.Color(style.kit.tyre),
	);
	// Flat and unlit, like every mark: a tail light that answers a cheer never glows.
	const lightGeo = new THREE.BoxGeometry(0.03, 0.045, 0.06);
	const lightMaterial = new THREE.MeshBasicMaterial({
		color: style.kit.tailLight,
	});
	const zones = style.zones.map((z) => new THREE.Color(z));
	// A silent trainer's ring: the neutral tone, none of Z1–Z7 (#3766), so nothing stale reads as a zone.
	const neutral = new THREE.Color(style.kit.skin);
	const chevronMaterial = () =>
		new THREE.MeshBasicMaterial({
			color: neon,
			side: THREE.DoubleSide,
			alphaHash: true,
		});

	const views = new Map<SimRider, View>();
	// A loadout is built once per level of detail; each rider wearing it draws a copy (#3156).
	const shapes = new Map<string, THREE.BufferGeometry>();
	function figureOf(o: Outfit, look: string, lod: 0 | 1, m: FigureMaterial) {
		const key = `${lod}:${look}`;
		let shape = shapes.get(key);
		if (!shape) {
			shape = buildFigure(o.kit, {
				lod,
				palette: o.palette,
				material: m,
			}).geometry;
			shapes.set(key, shape);
		}
		const figure = buildFigure(o.kit, {
			lod,
			material: m,
			geometry: shape.clone(),
		});
		m.userData.u.uTorso.value = figure.userData.rig.dims.torso;
		return figure;
	}
	function viewOf(r: SimRider, route: Route, crank: number, lod: 0 | 1): View {
		const known = views.get(r);
		if (known) return known;
		const hue = hueOf(r.id);
		const loadout = r.look ?? seededLoadout(r.id);
		const look = JSON.stringify(loadout);
		const outfit = outfitOf(loadout, style.kit, viewer);
		const material = figureMaterial(outfit.kit, outfit.decal, outfit.jersey);
		const figure = figureOf(outfit, look, lod, material);
		figure.rotation.y = -Math.PI / 2; // the figure's +X forward becomes the world's heading
		const anim = new RiderAnimator(figure, {
			seed: Math.round(hue * 1000),
			crank,
			remote: !r.you,
		});
		for (let t = 0; t < SETTLE_S; t += SETTLE_DT)
			anim.update(SETTLE_DT, inputOf(r, route));
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
		const thumb = new THREE.Mesh(
			thumbGeo,
			new THREE.MeshBasicMaterial({
				vertexColors: true,
				side: THREE.DoubleSide,
				alphaHash: true,
			}),
		);
		thumb.position.y = THUMB_Y;
		thumb.visible = false;
		// Under the saddle's tail, on the post, in the figure's own frame (+X forward).
		const light = new THREE.Mesh(lightGeo, lightMaterial);
		const seat = figure.userData.rig.fit.contact;
		light.position.set(seat.x - 0.035, seat.y - 0.09, 0);
		light.visible = false;
		figure.add(tag('marks', light, 'tail-light'));
		const g = new THREE.Group();
		shadow.visible = shadowed;
		g.userData.rider = r.id;
		g.add(
			tag('figures', figure),
			tag('marks', shadow),
			tag('marks', ring),
			tag('marks', bead),
			tag('marks', chevron, 'chevron'),
			tag('marks', thumb, 'cheer'),
		);
		group.add(g);
		const view: View = {
			group: g,
			figure,
			lod,
			anim,
			material,
			outfit,
			look,
			faded: false,
			ring,
			shadow,
			bead,
			chevron,
			thumb,
			light,
		};
		views.set(r, view);
		return view;
	}
	function drop(r: SimRider, v: View) {
		group.remove(v.group);
		v.figure.geometry.dispose();
		v.figure.skeleton.dispose();
		for (const m of [v.material, v.ring.material, v.shadow.material])
			m.dispose();
		v.bead.material.dispose();
		v.chevron.material.dispose();
		v.thumb.material.dispose();
		views.delete(r);
	}

	const trail = style.trail ? makeTrail(style.trail) : null;
	if (trail) group.add(tag('marks', trail.mesh, 'trail'));
	// Built the first time a bunch asks for it: a ride alone draws no car.
	let car: ReturnType<typeof makeCar> | null = null;
	const you = new THREE.Vector3();

	/** You and the riders nearest you, by road distance: the ones drawn in full detail. */
	function nearest(riders: SimRider[]): Set<SimRider> {
		const me = riders.find((r) => r.you);
		if (!me) return new Set(riders.slice(0, NEAR));
		const by = (r: SimRider) => (r === me ? -1 : Math.abs(r.d - me.d));
		return new Set([...riders].sort((a, b) => by(a) - by(b)).slice(0, NEAR));
	}
	/** The lighter or fuller figure, keeping its pose, colours and material. */
	function relod(v: View, lod: 0 | 1) {
		const next = figureOf(v.outfit, v.look, lod, v.material);
		v.figure.geometry.dispose();
		v.figure.geometry = next.geometry;
		next.skeleton.dispose();
		if (v.faded) fade(v);
		v.lod = lod;
	}
	/** A rider's kit in greys while their screen has gone, in their own colours again when it is back. */
	function fade(v: View) {
		const { palette, jersey } = v.outfit;
		const u = v.material.userData.u;
		paint(v.figure.geometry, v.faded ? greyed(palette) : palette);
		u.uJerseyB.value.copy(v.faded ? grey(jersey.b) : jersey.b);
		u.uJerseyC.value.copy(v.faded ? grey(jersey.c) : jersey.c);
	}
	let near = new Set<SimRider>();
	let sinceRank = Infinity;

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
		sinceRank += real;
		if (sinceRank >= RANK_EVERY || riders.some((r) => !views.has(r))) {
			sinceRank = 0;
			near = nearest(riders);
		}
		riders.forEach((r, i) => {
			const lane =
				r.lane ??
				(riders.length === 1 ? KEEP_RIGHT : 0) +
					(i - (riders.length - 1) / 2) * LANE;
			const lod = near.has(r) ? 0 : 1;
			const v = viewOf(r, route, pedal(r).crank, lod);
			if (v.lod !== lod) relod(v, lod);
			placeOn(v.group, route, r.d, lane);
			const alpha = r.alpha ?? 1;
			v.group.visible = alpha > 0;
			// Dithered while arriving or leaving, never blended (#3098); settled, the spokes keep their coverage.
			if (v.material.alphaHash !== alpha < 1) {
				v.material.alphaHash = alpha < 1;
				v.material.needsUpdate = true;
			}
			v.material.opacity = alpha;
			v.shadow.material.opacity = 0.28 * alpha;
			v.ring.material.opacity = 0.85 * alpha;
			if (v.faded !== !!r.faded) {
				v.faded = !!r.faded;
				fade(v);
			}
			// On the model view a rider is a bead, not a giant figurine.
			v.figure.visible = !overview;
			v.ring.visible = !overview && r.ring !== false;
			v.chevron.visible = !overview && !!r.coach;
			v.chevron.material.opacity = alpha;
			// A cheer for them (#3116): the thumb, then the light.
			const cheer = r.cheer;
			v.thumb.visible = !overview && !!cheer && cheer.thumb > 0;
			if (cheer) {
				v.thumb.scale.setScalar(Math.max(cheer.thumb, 1e-3));
				v.thumb.material.opacity = cheer.alpha * alpha;
			}
			v.light.visible = !overview && !!cheer?.lit;
			v.bead.visible = overview;
			v.bead.scale.setScalar(overview ? 22 : 1);
			v.bead.position.y = overview ? 22 : 0;
			v.ring.material.color.copy(
				r.silent ? neutral : zones[zoneOf(r.watts, r.ftp) - 1],
			);
			// The animator turns the legs at the rider's cadence, sits or stands them by SPEC's thresholds.
			const state = v.anim.update(dt, inputOf(r, route));
			pedal(r).crank = state.crank;
			pose(v.figure, state);
			if (r.you) {
				you.set(
					v.group.position.x,
					v.group.position.y + 1.1,
					v.group.position.z,
				);
				// No figure, no trail: a coach in the team car leaves none (#3771).
				if (trail) trail.mesh.visible = alpha > 0 && !r.silent;
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
		/** Kit colours that read as live data to this viewer, over every rider drawn: what a capture reports of the colour guard. */
		kitCollisions(): number {
			let n = 0;
			for (const { outfit } of views.values())
				for (const c of [
					...Object.values(outfit.palette),
					outfit.jersey.b,
					outfit.jersey.c,
				])
					if (collides(`#${c.getHexString()}`, viewer)) n++;
			return n;
		},
		/** Your figure, as a capture measures it (#3672). */
		get you(): THREE.SkinnedMesh | null {
			for (const [r, v] of views) if (r.you) return v.figure;
			return null;
		},
	};
}
export type Crew = ReturnType<typeof makeCrew>;
