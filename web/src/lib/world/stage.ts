// Everything a style paints that is not a rider: sky, light, terrain, road,
// props, furniture and the horizon. Rebuilt whole on a style change — the
// world data under it is not, and neither is the streamed ground it draws.
import * as THREE from 'three';
import { backdrop, type View } from './backdrop';
import { tag } from './family';
import { chunkId, LEAVE, roadPieces, type GroundStream } from './ground-stream';
import {
	batchProps,
	FAR_M,
	FETCH_AHEAD,
	NEAR_M,
	type Drawn,
} from './props/batch';
import { TILE_M, tileCentre, tileKey, tileOf } from './props/tiles';
import { batchBoards } from './boards';
import { archOnRoad } from './furniture';
import { Biome } from './biome';
import { roundaboutsOf, sceneOf } from './designed';
import { giveWays, roundabouts, stops } from './scenery';
import {
	BORE_BOXES,
	boreBoxes,
	bridges,
	galleries,
	Pieces,
	roadEdges,
	STONE_UNDER_SNOW_M,
	tunnels,
	type WorksColors,
} from './structures';
import type { Piece } from './setpieces';
import {
	plinth,
	road,
	surfaceOf,
	roadMaterial,
	ROAD_W,
	terrain,
	yOf,
} from './geometry';
import { lightsMaterial, lightsUniforms, OFF } from './lights';
import { flat, type Sight } from './materials';
import { LAMP_ARM } from './props';
import { piecePool } from './piece-pool';
import { merge } from './model';
import { shoreDressing } from './shore';
import { waterMaterial, waterSheets, type ShorePoint } from './water';
import { CHUNK_M } from './place/lattice';
import { prng } from './rand';
import type { Route } from '#lib/road/route.ts';
import { lightAt, sunDir } from './light';
import { DIORAMA } from './pixel';
import { spriteOwns } from './roadside-place';
import {
	setBores,
	setLight,
	skyMaterial,
	terrainMaterial,
	type Style,
} from './styles';
import { meshOf, REACH } from './terrain-mesh';
import { liftOf } from './road-surface';
import { endsMeet, SHOULDER } from './terrain/road-profile';
import type { World } from './world';

/**
 * How far round the eye the dressing's tiles are drawn: the far ring and the
 * half diagonal and more a tile's centre moves while the eye stays in its own
 * tile, so the batch's rings, measured from the eye itself, always find a
 * tile there to show.
 */
export const DRESS_M = FAR_M * FETCH_AHEAD + 1.5 * TILE_M;
/** What a ride keeps of its place round the eye (#3851): the ribbon's reach, and the dressing's with the neighbours a tile settles against, each with its hysteresis. */
const KEEP_M = Math.max(REACH.near, DRESS_M + 2 * TILE_M) * LEAVE;

/** Colour `a` mixed `t` of the way to `b`, and darkened to `k` of itself. */
const mixed = (a: string, b: string, t: number, k = 1) =>
	`#${new THREE.Color(a).lerp(new THREE.Color(b), t).multiplyScalar(k).getHexString()}`;

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
	/** Tiles within reach of the last eye still to be dressed, one an update. */
	filling(): boolean;
	/** The sky's band drawn from `eye` over the land in `view` as well as the far ranges: the ride's picture's (#4278). */
	bandOverLand(eye: THREE.Vector3, view: View): void;
	/**
	 * The orbit view: the whole model on its plinth and a fat road, no
	 * horizon — built the first time it is asked, the desk's diorama — or the
	 * ride's ground and road, streamed around the eye.
	 */
	setOrbit(on: boolean): void;
	/** The light at the ride's progress (null: no known end), and the fog colour it leaves. */
	light(p: number | null): THREE.Color;
	/** What carries words: the signs and the arches with their names (#4221's picture leaves them out). */
	labels: THREE.Object3D;
	/** The dressing's far ring shown or hidden, the quality ladder's (#3295). */
	setFar(on: boolean): void;
};

// Room for the ground within reach, and for a hilly road's pieces; either grows by half when it runs out.
const GROUND_ROOM = { pieces: 13_000, vertices: 200_000, indices: 800_000 };
/** The ground is culled by cells this wide, not piece by piece (piece-pool.ts, #4566). */
const GROUND_CELL_M = 960;
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
	/** The road ends under a finish arch; a lapped one does not. */
	finish = true,
): Stage {
	const group = new THREE.Group();
	const lights = lightsUniforms(sight.uTime);

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
	const sun = keyed ? new THREE.DirectionalLight(style.key, 2.2) : null;
	if (sun) {
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
		style.backdrop.snowCaps && (alpine || !!style.backdrop.tall),
	);
	skyMat.uniforms.uSkyline.value = ridges.skyline.texture;
	const horizon = new THREE.Mesh(ridges.geometry, horizonMat);
	horizon.frustumCulled = false;
	group.add(tag('sky', horizon));

	// The ride's ground, chunk by chunk as the stream holds it, and its road, piece by piece within the near reach.
	const groundMat = terrainMaterial(style, lights);
	const ground = piecePool(groundMat, GROUND_ROOM, GROUND_CELL_M);
	group.add(tag('terrain', ground.mesh));
	stream.attach({
		add: (id, [ci, cj], grid) =>
			ground.add(id, terrain(route, meshOf([{ ci, cj, grid }]), style.palette)),
		drop: (id) => ground.drop(id),
	});
	const snowline = sceneOf(route.scene)?.climate.snowline;
	const ribbon = piecePool(
		roadMaterial(
			style.road,
			lights,
			snowline === undefined
				? undefined
				: { y: yOf(route, snowline), color: style.palette[Biome.Snow] },
		),
		ROAD_ROOM,
	);
	group.add(tag('road', ribbon.mesh));
	// The road ridden, and the map's other roads where they leave it (side-roads.ts): a hair lower, so where one meets the ridden road it lies under its asphalt.
	const ribbons = [
		{
			of: world.ridden,
			lift: undefined as number | undefined,
			caps: undefined as readonly [boolean, boolean] | undefined,
		},
		...world.sides.map((s) => ({
			of: s.route,
			lift: liftOf(s.route, false) as number | undefined,
			caps: s.square
				? ([false, false] as const)
				: ([!s.mouths[0], !s.mouths[1]] as const),
		})),
	].map((r, j) => ({ ...r, j, pieces: roadPieces(r.of) }));
	let here: string | null = null;
	function roads(eye: THREE.Vector3) {
		const at = chunkId([
			Math.floor(eye.x / CHUNK_M),
			Math.floor(eye.z / CHUNK_M),
		]);
		if (at === here) return;
		here = at;
		for (const { of, lift, caps, j, pieces } of ribbons)
			pieces.forEach((p, k) => {
				const key = j === 0 ? String(k) : `${j}:${k}`;
				const d = Math.hypot(p.x - eye.x, p.z - eye.z) - p.r;
				if (d <= REACH.near && !ribbon.has(key))
					ribbon.add(
						key,
						road(of, {
							width: ROAD_W,
							shoulder: SHOULDER,
							rows: p.rows,
							lift,
							caps,
						}),
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
	/** The scene's own dressing, one draw: reeds and stones at its water's edge, its roundabouts' islands and signs. */
	const built: THREE.BufferGeometry[] = [];
	// A designed road's scene (designed.ts): its water, and the bridges that carry the road over it.
	if (world.scene !== undefined) {
		const both = flat(sight);
		both.side = THREE.DoubleSide;
		if (world.waters.length > 0) {
			const waterline: ShorePoint[] = [];
			group.add(
				tag(
					'terrain',
					new THREE.Mesh(
						waterSheets(route, world.waters, world.heightAt, waterline),
						waterMaterial(style, groundMat),
					),
				),
			);
			// Reeds and stones at its edge.
			const dressed = shoreDressing(route, waterline, world.clearOf, c);
			if (dressed) built.push(dressed);
		}
		// And what is built along it (structures.ts): its bridges, rails and walls, galleries and tunnels, in pieces along each road, one batch culled piece by piece.
		const palette = style.palette;
		const colors: WorksColors = {
			// Granite a shade paler than the villages' stone, as the pass road's is.
			stone: mixed(c.stone, c.wall, 0.2),
			concrete: mixed(c.stone, c.wall, 0.45),
			steel: c.pole,
			dark: mixed(c.stone, style.shade, 0.55, 0.42),
			lamp: c.wall,
			band: c.hiking,
			earth: palette[Biome.Meadow] ?? c.rock,
			snow: palette[Biome.Snow] ?? c.wall,
		};
		const works = new Pieces();
		bridges(
			works,
			'route',
			route,
			undefined,
			world.bridges,
			world.groundAt,
			colors,
		);
		tunnels(works, 'route', route, undefined, world.tunnels, colors);
		world.sides.forEach((s, j) => {
			const lift = liftOf(s.route, false);
			bridges(
				works,
				`side${j}`,
				s.route,
				lift,
				s.bridges,
				world.groundAt,
				colors,
				true,
			);
			tunnels(works, `side${j}`, s.route, lift, s.tunnels, colors);
		});
		galleries(
			works,
			'route',
			route,
			world.groundAt,
			world.galleries,
			snowline,
			colors,
		);
		roadEdges(
			works,
			'route',
			route,
			world.groundAt,
			[...world.bridges, ...world.galleries, ...world.tunnels],
			snowline === undefined ? Infinity : snowline - STONE_UNDER_SNOW_M,
			colors,
		);
		const pieces = works.geometries();
		if (pieces.size > 0) {
			let vertices = 0;
			for (const g of pieces.values()) vertices += g.attributes.position.count;
			const built = flat(sight, { lit: true });
			built.side = THREE.DoubleSide;
			const pool = piecePool(built, {
				pieces: pieces.size,
				vertices,
				indices: 0,
			});
			for (const [k, g] of pieces) pool.add(k, g);
			group.add(tag('road', pool.mesh));
		}
		// The ground drawn across a tunnel's mouth or in its portal's cutting is cut out of the tube (styles.ts uBores).
		const bores = [
			...boreBoxes(route, undefined, world.tunnels),
			...world.sides.flatMap((s) =>
				boreBoxes(s.route, liftOf(s.route, false), s.tunnels),
			),
		].slice(0, BORE_BOXES);
		setBores(groundMat, bores);
	}
	// Paint laid on a road, drawn over the ribbon it lies on from any distance, where a centimetre of height no longer tells in the depth buffer.
	const paintMaterial = () => {
		const paint = flat(sight);
		paint.side = THREE.DoubleSide;
		paint.polygonOffset = true;
		paint.polygonOffsetFactor = -2;
		paint.polygonOffsetUnits = -8;
		return paint;
	};
	// Its roundabouts: a statue on each island, the signs before each arm, and the give-way line across each way in.
	const rounds = roundaboutsOf(route.scene);
	if (rounds.length > 0) built.push(roundabouts(route, rounds, c));
	if (built.length > 0)
		group.add(
			tag(
				'dressing',
				new THREE.Mesh(
					built.length === 1 ? built[0] : merge(built),
					flat(sight),
				),
			),
		);
	if (rounds.length > 0) {
		group.add(
			tag(
				'road',
				new THREE.Mesh(
					giveWays(
						rounds,
						world.sides
							.filter((s) => s.route.widen)
							.map((s) => ({
								route: s.route,
								surface: surfaceOf(s.route, liftOf(s.route, false)),
							})),
						style.road.line,
					),
					paintMaterial(),
				),
			),
		);
	}
	// Where a side road comes in square (side-roads.ts): its stop line, STOP and its sign, laid on its own surface.
	if (world.sides.some((s) => s.mouths.some((m) => m))) {
		const paint = paintMaterial();
		group.add(
			tag(
				'road',
				new THREE.Mesh(
					stops(
						world.sides.map((s) => ({
							length: s.route.length,
							surface: surfaceOf(s.route, liftOf(s.route, false)),
							mouths: s.mouths.map((m) =>
								// Onto a roundabout nobody stops: no line, no STOP, no sign.
								!m || (m.met > 0 && world.sides[m.met - 1].route.level)
									? null
									: {
											...m,
											off: (x: number, z: number) => world.offJunction(m, x, z),
										},
							),
						})),
						{ line: style.road.line, sign: c.warning, post: c.pole },
					),
					paint,
				),
			),
		);
	}
	const treeMat = flat(sight, {
		wind: true,
		fade: true,
		snow: { lo: c.spruce, hi: c.spruceTip },
	});
	const houseMat = flat(sight, { fade: true });
	const plain = flat(sight);
	const props = batchProps(route, c, {
		trees: treeMat,
		buildings: houseMat,
		stock: plain,
		lights: lightsMaterial(sight, lights),
	});
	for (const mesh of props.meshes) group.add(tag('dressing', mesh));
	const starField = style.stars ? stars(style.stars) : null;
	if (starField) group.add(tag('sky', starField));

	// Each tile's signs and arch, stood with its tile and let go with it.
	const boards = batchBoards(route, style);
	group.add(tag('dressing', boards.root));
	// The count-in's reveal lands here (#3087): its digit hangs on this banner.
	// A road that ends where it began has one arch for both: two stood in each other, their banners through one another.
	const home = finish && !route.loop && endsMeet(route);
	group.add(
		tag(
			'dressing',
			archOnRoad(route, 0, home ? 'START / FINISH' : 'START', style),
			'arch',
		),
	);
	// The road's end (#3623): the world's route is the road the way it is ridden, so the finish is its last metre. A loop has none.
	if (finish && !route.loop && !home)
		group.add(
			tag('dressing', archOnRoad(route, route.length, 'FINISH', style), 'arch'),
		);
	// Each tile's lamps: where its pool falls under the head (xy) and where the lamp stands (zw).
	const pools = new Map<string, THREE.Vector4[]>();
	const poolsOf = (pieces: readonly Piece[]) =>
		pieces
			.filter((p) => p.kind === 'lamp')
			.map((p) => {
				const a = Math.atan2(p.turn[1], p.turn[0]); // as the batch turns it
				return new THREE.Vector4(
					p.x + LAMP_ARM * Math.sin(a),
					p.z + LAMP_ARM * Math.cos(a),
					p.x,
					p.z,
				);
			});
	/** The ground draws the pools nearest the eye (lights.ts POOLS). */
	function pool(eye: THREE.Vector3) {
		const near = [...pools.values()]
			.flat()
			.sort(
				(a, b) =>
					Math.hypot(a.x - eye.x, a.y - eye.z) -
					Math.hypot(b.x - eye.x, b.y - eye.z),
			);
		lights.uLamps.value.forEach((v, i) =>
			near[i] ? v.copy(near[i]) : v.setScalar(OFF),
		);
	}
	let lit = false;

	function draw(ti: number, tj: number, eye: THREE.Vector3) {
		const id = tileKey(ti, tj);
		const t = world.tile(ti, tj);
		pools.set(id, poolsOf(t.pieces));
		// Diorama 3D's trees and cows by the road are the roadside's sprites (roadside-place.ts).
		const own =
			DIORAMA.value > 0
				? t.props.filter((p) => !spriteOwns(world, p.kind, p.x, p.z))
				: t.props;
		props.add(id, tileCentre(ti, tj), [...own, ...t.pieces.map(drawn)], eye);
		boards.add(id, t.signs, t.arches);
	}
	function undraw(id: string) {
		pools.delete(id);
		props.drop(id);
		boards.drop(id);
	}
	let near: string | null = null;
	let wanted: [number, number][] = [];
	// Every wanted tile drawn: nothing to walk until the eye changes tile.
	let dressed = false;
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
			world.forget(eye.x, eye.z, KEEP_M);
			dressed = false;
		}
		if (dressed) return props.update(eye);
		let spent = false;
		let left = false;
		for (const [ti, tj] of wanted) {
			if (props.has(tileKey(ti, tj))) continue;
			const [cx, cz] = tileCentre(ti, tj);
			// Settling a tile costs its ground: the near ring now, else one a call, unless asked for all.
			if (
				!whole &&
				Math.hypot(cx - eye.x, cz - eye.z) >= NEAR_M &&
				!world.settled(ti, tj)
			) {
				if (spent) {
					left = true;
					continue;
				}
				spent = true;
			}
			draw(ti, tj, eye);
		}
		dressed = !left;
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
		labels: boards.root,
		setFar: props.setFar,
		update(eye, whole = false) {
			// The sky stands round the eye, so its band clears the ridges as this eye sees them.
			sky.position.copy(eye);
			ridges.skyline.from(eye);
			// The diorama holds still: only the rings move with a camera that orbits it.
			if (orbit) props.update(eye);
			else {
				dress(eye, whole);
				roads(eye);
			}
			pool(eye);
		},
		filling: () => !orbit && !dressed,
		bandOverLand(eye, view) {
			ridges.skyline.over(
				eye,
				(x, z) =>
					x < minX || x > maxX || z < minZ || z > maxZ
						? null
						: yOf(route, world.heightAt(x, z)),
				view,
			);
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
			// Lit at mount, the lights are on; lit later, they ease on from now (lights.ts).
			if (!l.lamps) lights.uLitAt.value = OFF;
			else if (lights.uLitAt.value === OFF)
				lights.uLitAt.value = lit ? sight.uTime.value : -OFF;
			lit = true;
			setLight(skyMat, l);
			setLight(groundMat, l);
			sun?.position.copy(l.sun).multiplyScalar(5000);
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
