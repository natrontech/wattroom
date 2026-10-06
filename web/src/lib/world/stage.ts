// Everything a style paints that is not a rider: sky, light, terrain, road,
// props, furniture and the horizon. Rebuilt whole on a style change — the
// world data under it is not, and neither is the streamed ground it draws.
import * as THREE from 'three';
import { backdrop } from './backdrop';
import { tag } from './family';
import { chunkId, LEAVE, roadPieces, type GroundStream } from './ground-stream';
import { batchProps, FAR_M, NEAR_M, type Drawn } from './props/batch';
import { TILE_M, tileCentre, tileKey, tileOf } from './props/tiles';
import { disposeTree } from './dispose';
import { arch, board } from './furniture';
import type { Piece } from './setpieces';
import { plinth, road, roadMaterial, ROAD_W, terrain, yOf } from './geometry';
import { PROP_RAMP, ramp, toon, type Sight } from './materials';
import { piecePool } from './piece-pool';
import { CHUNK_M } from './place/lattice';
import { prng } from './rand';
import type { Route } from '$lib/road/route';
import { lightAt, sunDir } from './light';
import { setLight, skyMaterial, terrainMaterial, type Style } from './styles';
import { meshOf, REACH } from './terrain-mesh';
import { SHOULDER } from './terrain/road-profile';
import type { World } from './world';

/**
 * How far round the eye the dressing's tiles are drawn: the far ring and the
 * half diagonal and more a tile's centre moves while the eye stays in its own
 * tile, so the batch's rings, measured from the eye itself, always find a
 * tile there to show.
 */
const DRESS_M = FAR_M + 1.5 * TILE_M;

/** A set piece as the batch draws it: a flag by its colour's model. */
const drawn = (p: Piece): Drawn => ({
	kind: p.kind === 'flag' ? (`flag${p.flag ?? 0}` as Drawn['kind']) : p.kind,
	x: p.x,
	z: p.z,
	base: p.y,
	turn: p.turn,
	scale: 1,
});

export type Stage = {
	group: THREE.Group;
	/**
	 * Brings what the stage draws to where the eye now is: the road's pieces,
	 * and the dressing's tiles — every one within reach on the first call or
	 * when `whole`, after that those within the near ring at once and the rest
	 * one a call, nearest first (#3699).
	 */
	update(eye: THREE.Vector3, whole?: boolean): void;
	/**
	 * The orbit view: the whole model on its plinth and a fat road, no
	 * horizon — built the first time it is asked, the desk's diorama — or the
	 * ride's ground and road, streamed around the eye.
	 */
	setOrbit(on: boolean): void;
	/** The light at the ride's progress (null: no known end), and the fog colour it leaves. */
	light(p: number | null): THREE.Color;
};

// Room for the ground within reach, and for a hilly road's pieces; either grows by half when it runs out.
const GROUND_ROOM = { pieces: 13_000, vertices: 200_000, indices: 800_000 };
const ROAD_ROOM = { pieces: 48, vertices: 48_000, indices: 240_000 };

const SKY_R = 40000;
const STARS = 2500;
const STARS_LOW = (15 * Math.PI) / 180; // the dark upper sky only, never the horizon's band
const STARS_FADE = (10 * Math.PI) / 180; // over which the lowest come in
/** The hemisphere light's strength: beside a sun's key, and alone once the sun has set. */
const HEMI_KEYED = 1.6;
const HEMI_SKY = 3.2;

function stars(
	color: string,
): THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial> {
	const r = prng(7);
	const pos = new Float32Array(STARS * 3);
	const fade = new Float32Array(STARS * 4).fill(1);
	const low = Math.sin(STARS_LOW);
	for (let i = 0; i < STARS; i++) {
		const a = r() * Math.PI * 2;
		const e = Math.asin(low + r() * (1 - low)); // even over the cap
		const d = 30000;
		fade[i * 4 + 3] = Math.min(1, (e - STARS_LOW) / STARS_FADE); // by alpha: a faint star is fainter, never darker than the sky
		pos.set(
			[
				Math.cos(a) * Math.cos(e) * d,
				Math.sin(e) * d,
				Math.sin(a) * Math.cos(e) * d,
			],
			i * 3,
		);
	}
	const g = new THREE.BufferGeometry();
	g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
	g.setAttribute('color', new THREE.BufferAttribute(fade, 4));
	const points = new THREE.Points(
		g,
		new THREE.PointsMaterial({
			color,
			vertexColors: true,
			size: 1.6,
			sizeAttenuation: false,
			fog: false,
			transparent: true,
			depthWrite: false,
		}),
	);
	points.frustumCulled = false;
	return points;
}

export function buildStage(
	route: Route,
	world: World,
	style: Style,
	sight: Sight,
	stream: GroundStream,
): Stage {
	const group = new THREE.Group();
	const gradient = ramp(PROP_RAMP);

	const skyMat = skyMaterial(style);
	const sky = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), skyMat);
	sky.scale.setScalar(SKY_R);
	sky.frustumCulled = false;
	sky.renderOrder = -1;
	group.add(tag('sky', sky));
	// The sun lights a look while it is up; once it has set the sky alone
	// does, soft and from above, with no key and no shadow (ADR-0072).
	const keyed = style.sun.elevation >= 0;
	const hemi = new THREE.HemisphereLight(
		keyed ? style.sky.top : style.key,
		style.shade,
	);
	group.add(hemi);
	if (keyed) {
		const sun = new THREE.DirectionalLight(style.key, 2.2);
		sun.position
			.copy(sunDir(style.sun.elevation, style.sun.azimuth))
			.multiplyScalar(5000);
		group.add(sun);
	}

	// Snow only where the route earns it — never on a flat loop.
	const alpine = route.maxEle > 1000 || route.gain / (route.length / 1000) > 20;
	const [minX, minZ, maxX, maxZ] = world.bounds;
	const radius = Math.hypot(maxX - minX, maxZ - minZ) / 2;
	const horizonMat = new THREE.MeshBasicMaterial({
		vertexColors: true,
		fog: false,
		side: THREE.DoubleSide,
	});
	const ridges = backdrop(
		route,
		world.seed,
		radius,
		{ ...style.backdrop, fog: style.sky.horizon },
		style.backdrop.snowCaps && alpine,
	);
	skyMat.uniforms.uSkyline.value = ridges.skyline.texture;
	const horizon = new THREE.Mesh(ridges.geometry, horizonMat);
	horizon.frustumCulled = false;
	group.add(tag('sky', horizon));

	// The ride's ground, chunk by chunk as the stream holds it, and its road, piece by piece within the near reach.
	const groundMat = terrainMaterial(style);
	const ground = piecePool(groundMat, GROUND_ROOM);
	group.add(tag('terrain', ground.mesh));
	stream.attach({
		add: (id, [ci, cj], grid) =>
			ground.add(id, terrain(route, meshOf([{ ci, cj, grid }]), style.palette)),
		drop: (id) => ground.drop(id),
	});
	const ribbon = piecePool(roadMaterial(style.road), ROAD_ROOM);
	group.add(tag('road', ribbon.mesh));
	const pieces = roadPieces(route);
	let here: string | null = null;
	function roads(eye: THREE.Vector3) {
		const at = chunkId([
			Math.floor(eye.x / CHUNK_M),
			Math.floor(eye.z / CHUNK_M),
		]);
		if (at === here) return;
		here = at;
		pieces.forEach((p, k) => {
			const key = String(k);
			const d = Math.hypot(p.x - eye.x, p.z - eye.z) - p.r;
			if (d <= REACH.near && !ribbon.has(key))
				ribbon.add(
					key,
					road(route, { width: ROAD_W, shoulder: SHOULDER, rows: p.rows }),
				);
			else if (d > REACH.near * LEAVE) ribbon.drop(key);
		});
	}

	const overview = new THREE.Mesh(
		road(route, { width: 70, lift: 6, step: 20 }),
		new THREE.MeshBasicMaterial({
			color: style.road.asphalt,
			transparent: true,
			opacity: 0.9,
		}),
	);
	overview.visible = false;
	group.add(tag('road', overview));

	const c = style.props;
	const treeMat = toon(gradient, sight, { wind: true, fade: true });
	const houseMat = toon(gradient, sight, { fade: true });
	const plain = toon(gradient, sight);
	const props = batchProps(route, c, {
		trees: treeMat,
		buildings: houseMat,
		stock: plain,
	});
	for (const mesh of props.meshes) group.add(tag('dressing', mesh));
	const starField = style.stars ? stars(style.stars) : null;
	if (starField) group.add(tag('sky', starField));

	// Each tile's signs and arch, built with its tile and let go with it.
	const boards = new Map<string, THREE.Object3D[]>();
	function draw(ti: number, tj: number, eye: THREE.Vector3) {
		const id = tileKey(ti, tj);
		const t = world.tile(ti, tj);
		props.add(
			id,
			tileCentre(ti, tj),
			[...t.props, ...t.pieces.map(drawn)],
			eye,
		);
		const shown = [
			...t.signs.map((s) => tag('dressing', board(route, s, style), 'sign')),
			...t.arches.map((a) => tag('dressing', arch(route, a, style), 'arch')),
		];
		if (shown.length === 0) return;
		group.add(...shown);
		boards.set(id, shown);
	}
	function undraw(id: string) {
		props.drop(id);
		for (const o of boards.get(id) ?? []) {
			group.remove(o);
			disposeTree(o);
		}
		boards.delete(id);
	}
	let near: string | null = null;
	let wanted: [number, number][] = [];
	// The first look draws everything in reach: a ride mounts with its far ring whole, never filling in.
	let first = true;
	function dress(eye: THREE.Vector3, asked: boolean) {
		const whole = asked || first;
		first = false;
		const here = tileKey(...tileOf(eye.x, eye.z));
		if (here !== near) {
			near = here;
			wanted = world.tilesWithin(eye.x, eye.z, DRESS_M);
			for (const id of props.ids()) {
				const [ti, tj] = id.split(':').map(Number);
				const [cx, cz] = tileCentre(ti, tj);
				if (Math.hypot(cx - eye.x, cz - eye.z) > DRESS_M * LEAVE) undraw(id);
			}
		}
		let spent = false;
		for (const [ti, tj] of wanted) {
			if (props.has(tileKey(ti, tj))) continue;
			const [cx, cz] = tileCentre(ti, tj);
			// Settling a tile costs its ground: the near ring now, else one a call, unless asked for all.
			if (
				!whole &&
				Math.hypot(cx - eye.x, cz - eye.z) >= NEAR_M &&
				!world.settled(ti, tj)
			) {
				if (spent) continue;
				spent = true;
			}
			draw(ti, tj, eye);
		}
		props.update(eye);
	}

	let orbit = false;
	let model: THREE.Object3D[] | null = null;
	/** The whole corridor, once: a diorama's ground and its plinth. */
	function diorama(): THREE.Object3D[] {
		const out: THREE.Object3D[] = [
			tag(
				'terrain',
				new THREE.Mesh(
					terrain(route, world.mesh, style.palette),
					ground.mesh.material,
				),
			),
		];
		if (style.plinth)
			out.push(
				tag(
					'terrain',
					new THREE.Mesh(
						plinth(route, world),
						new THREE.MeshLambertMaterial({
							color: style.plinth,
							side: THREE.DoubleSide,
						}),
					),
				),
			);
		group.add(...out);
		return out;
	}

	return {
		group,
		update(eye, whole = false) {
			// The sky stands round the eye, so its band meets the ridges where this eye sees them.
			sky.position.copy(eye);
			ridges.skyline.from(eye);
			// The diorama holds still: only the rings move with a camera that orbits it.
			if (orbit) props.update(eye);
			else {
				dress(eye, whole);
				roads(eye);
			}
		},
		setOrbit(on) {
			orbit = on;
			if (on) model ??= diorama();
			for (const o of model ?? []) o.visible = on;
			ground.mesh.visible = !on;
			ribbon.mesh.visible = !on;
			horizon.visible = !on;
			overview.visible = on;
		},
		light(p) {
			const l = lightAt(style, p);
			setLight(skyMat, l);
			setLight(groundMat, l);
			hemi.intensity = (l.keyed ? HEMI_KEYED : HEMI_SKY) * l.dusk;
			horizonMat.color.setScalar(l.dusk);
			if (starField) {
				starField.material.opacity = l.stars;
				starField.visible = l.stars > 0;
			}
			return new THREE.Color(style.sky.horizon).multiplyScalar(l.dusk);
		},
	};
}

// The summit, where the orbit view looks from and at.
export function summitOf(route: Route, world: World): THREE.Vector3 {
	const top = world.markers.find((m) => m.kind === 'summit');
	const i = Math.round((top?.d ?? 0) / route.step);
	return new THREE.Vector3(route.x[i], yOf(route, route.ele[i]), route.z[i]);
}
