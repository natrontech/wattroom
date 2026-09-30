// Everything a style paints that is not a rider: sky, light, terrain, road,
// props, furniture and the horizon. Rebuilt whole on a style change — the
// world data under it is not.
import * as THREE from 'three';
import { backdrop } from './backdrop';
import { tag } from './family';
import { batchProps } from './props/batch';
import { arch, board, kits } from './furniture';
import { plinth, road, roadMaterial, ROAD_W, terrain, yOf } from './geometry';
import { PROP_RAMP, ramp, toon, type Sight } from './materials';
import { prng } from './rand';
import type { Route } from '$lib/road/route';
import { skyMaterial, sunDir, terrainMaterial, type Style } from './styles';
import { SHOULDER } from './terrain/road-profile';
import type { World } from './world';

export type Stage = {
	group: THREE.Group;
	/** Brings what the stage draws to where the eye now is: the props' rings. */
	update(eye: THREE.Vector3): void;
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

	group.add(
		tag(
			'terrain',
			new THREE.Mesh(
				terrain(route, world, style.palette),
				terrainMaterial(style),
			),
		),
	);
	if (style.plinth)
		group.add(
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
	group.add(
		tag(
			'road',
			new THREE.Mesh(
				road(route, { width: ROAD_W, shoulder: SHOULDER }),
				roadMaterial(style.road),
			),
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
	group.add(tag('road', overview));

	const c = style.props;
	const treeMat = toon(gradient, sight, { wind: true, fade: true });
	const houseMat = toon(gradient, sight, { fade: true });
	const plain = toon(gradient, sight);
	const props = batchProps(route, world.props, c, {
		trees: treeMat,
		buildings: houseMat,
		stock: plain,
	});
	for (const mesh of props.meshes) group.add(tag('dressing', mesh));
	if (style.stars) group.add(tag('sky', stars(style.stars)));

	const leafy = toon(gradient, sight, { wind: true, fade: true });
	for (const k of kits(route, world, c, { fade: houseMat, leafy, flat: plain }))
		group.add(tag('dressing', k));
	for (const s of world.signs)
		group.add(tag('dressing', board(route, s, style), 'sign'));
	for (const a of world.arches)
		group.add(
			tag(
				'dressing',
				arch(
					route,
					a.d,
					`${a.label} · ${world.names.pass.toUpperCase()}`,
					style,
				),
				'arch',
			),
		);

	return { group, backdrop: horizon, overview, update: props.update };
}

// The summit, where the orbit view looks from and at.
export function summitOf(route: Route, world: World): THREE.Vector3 {
	const top = world.markers.find((m) => m.kind === 'summit');
	const i = Math.round((top?.d ?? 0) / route.step);
	return new THREE.Vector3(route.x[i], yOf(route, route.ele[i]), route.z[i]);
}
