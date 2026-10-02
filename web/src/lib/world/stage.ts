// Everything a style paints that is not a rider: sky, light, terrain, road,
// props, furniture and the horizon. Rebuilt whole on a style change — the
// world data under it is not, and neither is the streamed ground it draws.
import * as THREE from 'three';
import { backdrop } from './backdrop';
import { tag } from './family';
import { chunkId, LEAVE, roadPieces, type GroundStream } from './ground-stream';
import { batchProps, FAR_M, NEAR_M, type Drawn } from './props/batch';
import { tileCentre, tileKey, tileOf } from './props/tiles';
import { disposeTree } from './dispose';
import { arch, board } from './furniture';
import type { Piece } from './setpieces';
import { plinth, road, roadMaterial, ROAD_W, terrain, yOf } from './geometry';
import { PROP_RAMP, ramp, toon, type Sight } from './materials';
import { piecePool } from './piece-pool';
import { CHUNK_M } from './place/lattice';
import { prng } from './rand';
import type { Route } from '$lib/road/route';
import { skyMaterial, sunDir, terrainMaterial, type Style } from './styles';
import { meshOf, REACH } from './terrain-mesh';
import { SHOULDER } from './terrain/road-profile';
import type { World } from './world';

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
	 * and the dressing's tiles — those within the near ring at once, the rest
	 * one a call, nearest first (#3699), or every one within reach when
	 * `whole`.
	 */
	update(eye: THREE.Vector3, whole?: boolean): void;
	/**
	 * The orbit view: the whole model on its plinth and a fat road, no
	 * horizon — built the first time it is asked, the desk's diorama — or the
	 * ride's ground and road, streamed around the eye.
	 */
	setOrbit(on: boolean): void;
};

// Room for the ground within reach, and for a hilly road's pieces; either grows by half when it runs out.
const GROUND_ROOM = { pieces: 13_000, vertices: 200_000, indices: 800_000 };
const ROAD_ROOM = { pieces: 48, vertices: 48_000, indices: 240_000 };

const SKY_R = 40000;
const STARS = 2500;

function stars(color: string): THREE.Points {
	const r = prng(7);
	const pos = new Float32Array(STARS * 3);
	for (let i = 0; i < STARS; i++) {
		const a = r() * Math.PI * 2;
		const e = 0.04 + r() * 0.9; // above the horizon only
		const d = 30000;
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
	const points = new THREE.Points(
		g,
		new THREE.PointsMaterial({
			color,
			size: 1.6,
			sizeAttenuation: false,
			fog: false,
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

	const sky = new THREE.Mesh(
		new THREE.SphereGeometry(1, 32, 16),
		skyMaterial(style),
	);
	sky.scale.setScalar(SKY_R);
	sky.frustumCulled = false;
	sky.renderOrder = -1;
	group.add(tag('sky', sky));
	group.add(new THREE.HemisphereLight(style.sky.top, style.shade, 1.6));
	const sun = new THREE.DirectionalLight(style.key, 2.2);
	sun.position.copy(sunDir(style).multiplyScalar(5000));
	group.add(sun);

	// Snow only where the route earns it — never on a flat loop.
	const alpine = route.maxEle > 1000 || route.gain / (route.length / 1000) > 20;
	const [minX, minZ, maxX, maxZ] = world.bounds;
	const radius = Math.hypot(maxX - minX, maxZ - minZ) / 2;
	const horizon = new THREE.Mesh(
		backdrop(
			route,
			world.seed,
			radius,
			{ ...style.backdrop, fog: style.sky.horizon },
			style.backdrop.snowCaps && alpine,
		),
		new THREE.MeshBasicMaterial({
			vertexColors: true,
			fog: false,
			side: THREE.DoubleSide,
		}),
	);
	horizon.frustumCulled = false;
	group.add(tag('sky', horizon));

	// The ride's ground, chunk by chunk as the stream holds it, and its road, piece by piece within the near reach.
	const ground = piecePool(terrainMaterial(style), GROUND_ROOM);
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
	if (style.stars) group.add(tag('sky', stars(style.stars)));

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
	function dress(eye: THREE.Vector3, whole: boolean) {
		const here = tileKey(...tileOf(eye.x, eye.z));
		if (here !== near) {
			near = here;
			wanted = world.tilesWithin(eye.x, eye.z, FAR_M);
			for (const id of props.ids()) {
				const [ti, tj] = id.split(':').map(Number);
				const [cx, cz] = tileCentre(ti, tj);
				if (Math.hypot(cx - eye.x, cz - eye.z) > FAR_M * LEAVE) undraw(id);
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
	};
}

// The summit, where the orbit view looks from and at.
export function summitOf(route: Route, world: World): THREE.Vector3 {
	const top = world.markers.find((m) => m.kind === 'summit');
	const i = Math.round((top?.d ?? 0) / route.step);
	return new THREE.Vector3(route.x[i], yOf(route, route.ele[i]), route.z[i]);
}
