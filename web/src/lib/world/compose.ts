// The ride world as a scene graph, and how it moves (#3083): the sim, the
// camera rig, the stage and the riders, with no renderer. scene.ts draws it;
// the scene budget measures exactly what scene.ts would draw.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createBunch, type Car } from './bunch';
import { makeCrew, type Crew, type Pedalling } from './crew';
import type { BunchView } from '$lib/channel/bunch-view';
import { DEFAULT_DARK_ID, themeById } from '$lib/themes';
import { disposeTree } from './dispose';
import { makeSight } from './materials';
import { makeRig, type Follow } from './rig';
import { GEO } from './rider-rig';
import { type Route } from '$lib/road/route';
import { at } from '$lib/road/along';
import {
	advance,
	followMetre,
	simRider,
	trainerFor,
	type Env,
	type RideMetre,
	type SimRider,
} from './sim';
import { buildStage, summitOf, type Stage } from './stage';
import { placeGrids } from './chunks/grids';
import { streamGround, type GotGrid, type Grids } from './ground-stream';
import type { Style } from './styles';
import type { Failure } from './ride-view';
import type { World } from './world';

export type CameraMode = Follow | 'orbit';

export type Hud = {
	kmh: number;
	grade: number; // the road's, percent
	trainer: number; // what the trainer would be told, percent
	km: number;
	ele: number;
	toTop: number; // km to the summit, negative once past it
	riders: { id: string; name: string; you: boolean; d: number; lane: number }[];
};

export type MountOptions = {
	route: Route;
	world: World;
	style: Style;
	camera?: CameraMode;
	watts?: number;
	ftp: number; // the signed-in rider's: your cadence and zone ring read against it
	speedup?: number;
	onTick?: (hud: Hud) => void; // a few times a second, while the loop runs
	/** Once, when a world that started stops: rideView() takes it from there (#3080). */
	onFail?: (why: Failure) => void;
	/** Who rides, you among them: the dev gallery's crew. Absent, you ride alone. */
	riders?: SimRider[];
	/**
	 * The ride's own place on its road, a ride's world only (#3663): your
	 * figure rides it, and the world moves nobody of its own and tells the
	 * ride nothing.
	 */
	metre?: () => RideMetre;
	/**
	 * Everyone on the road with you, a session's world only (#3098): the
	 * bunch places every joined rider, you among them, and the team car.
	 */
	bunch?: () => BunchView | null;
	/** Your rider id: which of the bunch is you. */
	youId?: string;
	/** The theme's structural accent, for the coach's chevron; Outrun's absent. */
	neon?: string;
	/** Where the streamed ground's chunks come from: the page's copy, then the build worker (#3606). */
	grids?: (got: GotGrid) => Grids;
	/**
	 * A still moment, the dev gallery's (#3672): every rider, crank and
	 * breath of wind placed from the metre, drawn and held, so two loads of
	 * one moment are one frame. `p` is the ride's progress, 0–1, for the light.
	 */
	moment?: Moment;
};

export type Moment = { m: number; p: number };

/** Metres a crank turn carries a rider: a moment's pedals are placed by it. */
const CRANK_M = 7;

const HUD_EVERY = 0.25; // seconds of real time between HUD snapshots
const SUBSTEP = 0.1; // sim seconds per integration step, so 16× does not tunnel through a crest

/** The scene for `opts`; `dom` is what the orbit view's controls listen on, when there is one. */
export function compose(opts: MountOptions, dom: HTMLElement | null) {
	const { route, world } = opts;
	let mode: CameraMode = opts.camera ?? 'chase';
	let speedup = opts.speedup ?? 1;
	const env: Env = { difficulty: 0.5 };
	let riders = opts.riders ?? [
		simRider({
			id: opts.youId ?? 'you',
			name: 'You',
			mass: 80,
			ftp: opts.ftp,
			you: true,
			watts: opts.watts ?? 200,
			d: 0,
		}),
	];
	const you = riders.find((r) => r.you) ?? riders[0];
	// On a ride your figure is the ride's; only the gallery's crew is stepped here.
	const stepped = opts.metre ? riders.filter((r) => r !== you) : riders;
	const follow = followMetre();
	// What each rider's legs are doing, kept across style changes.
	const legs = new WeakMap<SimRider, Pedalling>();
	const pedal = (r: SimRider): Pedalling => {
		let p = legs.get(r);
		if (!p) legs.set(r, (p = { crank: 0, wheel: 0, stand: 0 }));
		return p;
	};
	const bunch = opts.bunch ? createBunch() : null;
	// The bunch's riders by id, so a figure keeps its legs from frame to frame.
	const crewmates = new Map<string, SimRider>();
	let car: Car | null = null;
	const neon = new THREE.Color(
		opts.neon ?? themeById(DEFAULT_DARK_ID)!.tokens.neon,
	);
	const summit = world.markers.find((m) => m.kind === 'summit');
	const moment = opts.moment;
	if (moment)
		riders.forEach((r) => {
			r.d = r.at = moment.m + r.d;
			// A stand-in rides the watts its model gives it there, so its ring shows a zone.
			if (r.ride) r.watts = r.ride(r, at(route, r.d).grade, moment.m);
			pedal(r).crank = (r.d / CRANK_M) * 2 * Math.PI;
			pedal(r).wheel = r.d / GEO.wheelR;
		});

	const scene = new THREE.Scene();
	// Near at 1 m: at 0.5 the depth buffer resolved 0.12 m at 1 km, and the
	// road's shoulder z-fought from about 1.26 km (#3078).
	const camera = new THREE.PerspectiveCamera(52, 1, 1, 60000);
	const sight = makeSight();
	const rig = makeRig(route, world);
	const stream = streamGround(
		opts.grids ?? ((got) => placeGrids(world, got)),
		world.level,
	);
	let stage: Stage | null = null;
	let crew: Crew | null = null;
	let controls: OrbitControls | null = null;

	function applyMode() {
		const orbit = mode === 'orbit';
		stage?.setOrbit(orbit);
		if (orbit && !controls) {
			// Open on the whole model, tilted like a diorama on a table.
			const target = summitOf(route, world);
			camera.position.set(target.x + 8000, target.y + 7500, target.z + 9000);
			camera.lookAt(target);
			controls = new OrbitControls(camera, dom ?? undefined);
			controls.target.copy(target);
			controls.enableDamping = true;
			controls.maxPolarAngle = Math.PI * 0.47;
		}
		if (!orbit && controls) {
			controls.dispose();
			controls = null;
			rig.reset();
		}
	}

	function dress(style: Style) {
		for (const old of [stage?.group, crew?.group]) {
			if (!old) continue;
			scene.remove(old);
			disposeTree(old);
		}
		stage = buildStage(route, world, style, sight, stream);
		crew = makeCrew(style, neon);
		scene.add(stage.group, crew.group);
		scene.fog = new THREE.FogExp2(style.sky.horizon, style.fogK * 1.1);
		applyMode();
	}

	function hud(): Hud {
		const p = at(route, you.d);
		const lap = (d: number) => (route.loop ? d % route.length : d);
		return {
			kmh: you.v * 3.6,
			grade: p.grade,
			trainer: trainerFor(route, you, env),
			km: you.d / 1000,
			ele: p.ele,
			toTop: summit ? (summit.d - lap(you.d)) / 1000 : 0,
			riders: riders.map((r) => ({
				id: r.id,
				name: r.name,
				you: r.you,
				d: lap(r.d),
				lane: r.lane ?? 0,
			})),
		};
	}

	let t = 0;
	let sinceHud = HUD_EVERY;
	/** `wall` is the real time the frame took, unclamped: what the bunch is laid out by (#3098). */
	function advanceBy(seconds: number, wall = seconds) {
		if (!crew) return;
		// A moment holds: nothing it draws moves with the clock.
		const real = moment ? 0 : seconds;
		const dt = real * speedup;
		t += dt;
		sight.uTime.value += real;
		const n = Math.max(1, Math.ceil(dt / SUBSTEP));
		for (let k = 0; k < n; k++) advance(route, stepped, dt / n, t);
		const view = opts.bunch?.();
		if (bunch && view) ride(view, moment ? 0 : wall);
		else if (opts.metre) follow(you, opts.metre(), real);
		const me = crew.update(route, riders, pedal, dt, real, mode === 'orbit');
		crew.drive(route, car, mode === 'orbit');
		if (controls) controls.update();
		else rig.update(camera, mode === 'heli' ? 'heli' : 'chase', you, me, real);
		sight.uCam.value.copy(camera.position);
		sight.uYou.value.copy(me);
		look();
		sinceHud += moment ? 0 : wall;
		if (sinceHud >= HUD_EVERY) {
			sinceHud = 0;
			opts.onTick?.(hud());
		}
	}

	/**
	 * Lays the bunch out for this frame: everyone in it where it says,
	 * you included while you ride in it, and the team car (#3098).
	 */
	function ride(view: BunchView, real: number) {
		const out = bunch!.step(view, real, Date.now());
		const placed = new Set<string>();
		for (const p of out.riders) {
			placed.add(p.id);
			let r = p.id === you.id ? you : crewmates.get(p.id);
			if (!r) {
				r = simRider({
					id: p.id,
					name: '',
					mass: 0,
					ftp: 0,
					you: false,
					watts: 0,
					d: p.d,
				});
				r.ring = false;
				crewmates.set(p.id, r);
			}
			Object.assign(r, {
				d: p.d,
				at: p.d,
				v: p.v,
				lane: p.lane,
				alpha: p.alpha,
				faded: p.faded,
				coach: p.coach,
			});
			if (r !== you) Object.assign(r, { watts: p.watts, ftp: p.ftp });
		}
		for (const id of crewmates.keys())
			if (!placed.has(id)) crewmates.delete(id);
		// Not in it — watching, or before the plan runs: you ride the ride's metre, as alone.
		if (!placed.has(you.id)) {
			if (opts.metre) follow(you, opts.metre(), real);
			you.lane = you.alpha = undefined;
		}
		riders = [you, ...crewmates.values()];
		car = out.car;
	}

	/** The ground, the road and the props' rings, brought to where the eye now is; the diorama holds still. */
	function look() {
		if (!controls) stream.update(camera.position.x, camera.position.z);
		stage?.update(camera.position);
	}

	dress(opts.style);
	if (moment) sight.uTime.value = moment.m / 10;
	advanceBy(0);

	return {
		scene,
		camera,
		dress,
		advanceBy,
		/** Brings the level of detail to where the camera now stands, after moving it by hand (the scene budget does). */
		look,
		setCamera(next: CameraMode) {
			mode = next;
			applyMode();
		},
		setWatts(watts: number) {
			you.watts = watts;
		},
		setSpeedup(factor: number) {
			speedup = factor;
		},
		/** Nothing moves: a held moment, or you have stopped pedalling, every rider stands and nobody turns the model. */
		idle: () =>
			!!moment ||
			(you.watts === 0 && !controls && riders.every((r) => r.v < 0.05)),
		/**
		 * What a design capture measures (#3672, docs/design/TARGETS.md): the
		 * field of view, the moment drawn, and your figure's height on screen
		 * as a share of the frame.
		 */
		probe() {
			const box = new THREE.Box3();
			const figure = crew?.you;
			let bboxH = 0;
			if (figure) {
				figure.updateWorldMatrix(true, false);
				camera.updateMatrixWorld();
				box.setFromObject(figure);
				let lo = Infinity;
				let hi = -Infinity;
				const v = new THREE.Vector3();
				for (const x of [box.min.x, box.max.x])
					for (const y of [box.min.y, box.max.y])
						for (const z of [box.min.z, box.max.z]) {
							v.set(x, y, z).project(camera);
							lo = Math.min(lo, v.y);
							hi = Math.max(hi, v.y);
						}
				bboxH = Math.round(((hi - lo) / 2) * 1000) / 1000;
			}
			return {
				camera: { fov: Math.round(camera.fov * 100) / 100 },
				moment: moment ?? null,
				figure: { bboxH },
			};
		},
		dispose() {
			controls?.dispose();
			stream.dispose();
			disposeTree(scene);
		},
	};
}

export type Composed = ReturnType<typeof compose>;
