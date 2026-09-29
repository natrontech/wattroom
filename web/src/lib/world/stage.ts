// Everything a style paints that is not a rider: sky, light, terrain, road,
// props, furniture and the horizon. Rebuilt whole on a style change — the
// world data under it is not.
import * as THREE from 'three';
import { backdrop } from './backdrop';
import { arch, board, kits } from './furniture';
import {
	instanced,
	plinth,
	road,
	roadMaterial,
	ROAD_W,
	terrain,
	yOf,
} from './geometry';
import { PROP_RAMP, ramp, toon, type Sight } from './materials';
import * as P from './props';
import { prng } from './rand';
import type { Route } from './route';
import { skyMaterial, sunDir, terrainMaterial, type Style } from './styles';
import type { World } from './world';

export type Stage = {
	group: THREE.Group;
	backdrop: THREE.Object3D; // the horizon, hidden from the orbit view
	overview: THREE.Object3D; // a fat road, drawn only from the orbit view
};

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
	group.add(sky);
	group.add(new THREE.HemisphereLight(style.sky.top, style.shade, 1.6));
	const sun = new THREE.DirectionalLight(style.key, 2.2);
	sun.position.copy(sunDir(style).multiplyScalar(5000));
	group.add(sun);

	// Snow only where the route earns it — never on a flat loop.
	const alpine = route.maxEle > 1000 || route.gain / (route.length / 1000) > 20;
	const radius = Math.hypot(world.nx * world.cell, world.nz * world.cell) / 2;
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
	group.add(horizon);

	group.add(
		new THREE.Mesh(
			terrain(route, world, style.palette),
			terrainMaterial(style),
		),
	);
	if (style.plinth)
		group.add(
			new THREE.Mesh(
				plinth(route, world),
				new THREE.MeshLambertMaterial({
					color: style.plinth,
					side: THREE.DoubleSide,
				}),
			),
		);
	group.add(
		new THREE.Mesh(
			road(route, { width: ROAD_W, shoulder: 1.6 }),
			roadMaterial(style.road),
		),
	);
	const overview = new THREE.Mesh(
		road(route, { width: 70, lift: 6, step: 20 }),
		new THREE.MeshBasicMaterial({
			color: style.road.asphalt,
			transparent: true,
			opacity: 0.9,
		}),
	);
	overview.visible = false;
	group.add(overview);

	const c = style.props;
	const treeMat = toon(gradient, sight, { wind: true, fade: true });
	const houseMat = toon(gradient, sight, { fade: true });
	const plain = toon(gradient, sight);
	const T = world.trees;
	const H = world.houses;
	const kind = (arr: Float32Array, stride: number, k: number) => (i: number) =>
		arr[i * stride + 4] === k;
	const place = (
		geo: THREE.BufferGeometry,
		mat: THREE.Material,
		data: Float32Array,
		stride: number,
		opts: Parameters<typeof instanced>[5],
	) => group.add(instanced(route, geo, mat, data, stride, opts));
	place(P.spruce(c), treeMat, T, 5, {
		keep: kind(T, 5, 0),
		scale: (i) => T[i * 5 + 3],
		rot: (i) => i * 2.4,
		sink: 0.6,
	});
	place(P.broadleaf(c), treeMat, T, 5, {
		keep: kind(T, 5, 1),
		scale: (i) => T[i * 5 + 3],
		rot: (i) => i * 1.7,
		sink: 0.6,
	});
	const buildings = [P.house, P.church, P.barn, P.hut];
	buildings.forEach((model, k) =>
		place(model(c), houseMat, H, 5, {
			keep: kind(H, 5, k),
			rot: (i) => H[i * 5 + 3],
			sink: k === 3 ? 0.6 : 0.8,
		}),
	);
	place(P.cow(c), plain, world.cows, 4, { rot: (i) => world.cows[i * 4 + 3] });
	place(P.rock(c), plain, world.rocks, 4, {
		scale: (i) => world.rocks[i * 4 + 3],
		rot: (i) => i * 1.3,
		sink: 0.3,
	});
	if (style.stars) group.add(stars(style.stars));

	const leafy = toon(gradient, sight, { wind: true, fade: true });
	for (const k of kits(route, world, c, { fade: houseMat, leafy, flat: plain }))
		group.add(k);
	for (const s of world.signs) group.add(board(route, s, style));
	for (const a of world.arches)
		group.add(
			arch(route, a.d, `${a.label} · ${world.names.pass.toUpperCase()}`, style),
		);

	return { group, backdrop: horizon, overview };
}

// The summit, where the orbit view looks from and at.
export function summitOf(route: Route, world: World): THREE.Vector3 {
	const top = world.markers.find((m) => m.kind === 'summit');
	const i = Math.round((top?.d ?? 0) / route.step);
	return new THREE.Vector3(route.x[i], yOf(route, route.ele[i]), route.z[i]);
}
