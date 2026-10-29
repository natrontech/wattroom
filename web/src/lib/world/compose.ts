// The ride world as a scene graph, and how it moves (#3083): the sim, the
// camera rig, the stage and the riders, with no renderer. scene.ts draws it;
// the scene budget measures exactly what scene.ts would draw.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createBunch, type Car } from './bunch';
import { createAlongside } from './alongside';
import { MOST_ABREAST } from './lanes';
import { CHEER_S, cheerLook } from './cheer';
import { makeChalk, type ChalkLayer } from './chalk';
import { makeGates, type GatesLayer } from './gates';
import type { PaintedGate } from '$lib/road/gates';
import { makeGameRoad, type GameRoad } from './game-road';
import { roadsideSound } from '$lib/roadside';
import {
	loadoutOf,
	makeCrew,
	RING_BAND_M,
	type Crew,
	type Pedalling,
} from './crew';
import { makeGhosts, MOST_GHOSTS, type GhostAt, type Ghosts } from './ghosts';
import { bunchLooks, type Loadout } from './loadout';
import { makeTags, type Tags } from './tags';
import type { BunchView } from '$lib/channel/bunch-view';
import type { RoadMate } from '$lib/channel/road-mates';
import { DEFAULT_DARK_ID, themeById } from '$lib/themes';
import { disposeTree } from './dispose';
import { CAMERA } from './camera';
import { exponentialFog, propFogDensity } from './fog';
import { makeSight } from './materials';
import { makeRig, type Follow } from './rig';
import { HOLD_S, type RevealView } from './reveal';
import { type Route } from '$lib/road/route';
import { at, leftOf } from '$lib/road/along';
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
import { yOf } from './geometry';
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
	riders: {
		id: string;
		name: string;
		you: boolean;
		d: number;
		/** Their speed along the road, m/s: a racer's is their own (#3778). */
		v: number;
		lane: number;
	}[];
	/** The count-in's shot on this frame (#3087): flying the reveal, or standing on the arch; null off the count-in. */
	shot: 'flying' | 'still' | null;
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
	/**
	 * Channel-mates free-riding this road (#3117), or the other racers on a
	 * race's (#3778): each at their own metre, never in a bunch. Drawn only
	 * while the bunch has no view.
	 */
	mates?: () => readonly RoadMate[];
	/** The session laps the road (#3623): no finish arch on it. */
	loop?: boolean;
	/** Your rider id: which of the bunch is you. */
	youId?: string;
	/** The theme's structural accent, for the coach's chevron; Outrun's absent. */
	neon?: string;
	/** Reduced motion, read each frame: a cheer's thumb and light hold still, the fog sea steps (ADR-0079). */
	steady?: () => boolean;
	/** The World control's Light (#3214): the world draws at half the pixel budget, above the floor. */
	light?: boolean;
	/** A sound the road makes (#3114): the cowbell, as the bunch rides past someone a game put out. */
	onCue?: (cue: 'cowbell') => void;
	/** Where the streamed ground's chunks come from: the page's copy, then the build worker (#3606). */
	grids?: (got: GotGrid) => Grids;
	/**
	 * A still moment, the dev gallery's (#3672): every rider, crank and
	 * breath of wind placed from the metre, drawn and held, so two loads of
	 * one moment are one frame. `p` is the ride's progress, 0–1, for the light.
	 */
	moment?: Moment;
	/**
	 * The ride's count-in, a ride's world only (#3087): the seconds left and
	 * its length, null once it is over. The eye flies a reveal to the start
	 * arch over it, or stands on the arch under reduced motion (ADR-0079).
	 */
	countIn?: () => { left: number; total: number } | null;
	/**
	 * Your ghosts on this road, a solo ride's world only (#3245, ADR-0068):
	 * where each is now. Each rides see-through in your kit, beside you.
	 */
	ghosts?: () => RideMetre[];
	/** A workout's next blocks on this road (#3101), in the ride's metres: painted where each starts. */
	gates?: () => readonly PaintedGate[];
};

export type Moment = { m: number; p: number };

/** Metres a crank turn carries a rider: a moment's pedals are placed by it. */
const CRANK_M = 7;

const HUD_EVERY = 0.25; // seconds of real time between HUD snapshots
const SUBSTEP = 0.1; // sim seconds per integration step, so 16× does not tunnel through a crest

/** The scene for `opts`; `dom` is what the orbit view's controls listen on, when there is one. */
export function compose(opts: MountOptions, dom: HTMLElement | null) {
	const { world } = opts;
	// A session that laps the road rides it round (#3623): the bunch, its chalk
	// and its gates count laps unrolled, and past the end each is on the next lap.
	const route = opts.loop ? { ...opts.route, loop: true } : opts.route;
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
	const follow = followMetre(route);
	// What each rider's legs are doing, kept across style changes.
	const legs = new WeakMap<SimRider, Pedalling>();
	const pedal = (r: SimRider): Pedalling => {
		let p = legs.get(r);
		if (!p) legs.set(r, (p = { crank: 0 }));
		return p;
	};
	const bunch = opts.bunch ? createBunch() : null;
	// The bunch's riders by id, so a figure keeps its legs from frame to frame.
	const crewmates = new Map<string, SimRider>();
	// Channel-mates on a free ride's road or racers on a race's, each on their own metre (#3117, #3778).
	const alongside = opts.mates ? createAlongside(route) : null;
	// What each of them wears, spread over the bunch in its join order (#3791); worked out again only when that order changes.
	let looks = new Map<string, Loadout>();
	let lookedAt = '';
	let car: Car | null = null;
	// Cheers for one rider (#3116): when each was heard, on the ride's own clock.
	const cheered = new Map<string, number>();
	let heard: unknown;
	let clock = 0;
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
		});

	const scene = new THREE.Scene();
	// The roadside's chalk, on a bunch's road only (#3029); painted in the style's road line.
	let chalk: ChalkLayer | null = null;
	let gates: GatesLayer | null = null;
	// Near at 1 m: at 0.5 the depth buffer resolved 0.12 m at 1 km, and the
	// road's shoulder z-fought from about 1.26 km (#3078).
	const camera = new THREE.PerspectiveCamera(52, 1, CAMERA.near, CAMERA.far);
	const sight = makeSight();
	const rig = makeRig(route, world);
	const stream = streamGround(
		opts.grids ?? ((got) => placeGrids(world, got)),
		world.level,
	);
	let stage: Stage | null = null;
	let crew: Crew | null = null;
	let game: GameRoad | null = null;
	let tags: Tags | null = null;
	let ghosts: Ghosts | null = null;
	// Each ghost eases onto its metre as your figure does (#3663).
	const haunts = Array.from({ length: MOST_GHOSTS }, () => ({
		at: { d: 0, at: 0, v: 0 },
		follow: followMetre(),
	}));
	function ghostsNow(real: number): GhostAt[] {
		return (opts.ghosts?.() ?? []).slice(0, MOST_GHOSTS).map((g, i) => {
			haunts[i].follow(haunts[i].at, g, real);
			return haunts[i].at;
		});
	}
	let progress: number | null = moment ? moment.p : null;
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
		for (const old of [
			stage?.group,
			crew?.group,
			game?.group,
			tags?.group,
			chalk?.group,
			ghosts?.group,
			gates?.group,
		]) {
			if (!old) continue;
			scene.remove(old);
			disposeTree(old);
		}
		// The road itself is drawn as it is, its ends where they lie.
		stage = buildStage(opts.route, world, style, sight, stream, !opts.loop);
		crew = makeCrew(style, neon);
		game = makeGameRoad(route, world, style);
		tags = makeTags(style);
		scene.add(stage.group, crew.group, game.group, tags.group);
		if (opts.ghosts) {
			ghosts = makeGhosts(style, loadoutOf(you), opts.ftp);
			scene.add(ghosts.group);
		}
		if (bunch) {
			chalk = makeChalk(route, style);
			scene.add(chalk.group);
		}
		if (opts.gates) {
			gates = makeGates(route, style);
			scene.add(gates.group);
		}
		exponentialFog();
		scene.fog = new THREE.FogExp2(
			style.sky.horizon,
			propFogDensity(style.fogK),
		);
		light();
		applyMode();
	}

	/** The sky, the ground and the fog at the ride's progress. */
	function light() {
		if (stage && scene.fog) scene.fog.color.copy(stage.light(progress));
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
			shot,
			toTop: summit ? (summit.d - lap(you.d)) / 1000 : 0,
			riders: riders.map((r) => ({
				id: r.id,
				name: r.name,
				you: r.you,
				d: lap(r.d),
				v: r.v,
				lane: r.lane ?? 0,
			})),
		};
	}

	let t = 0;
	let wallClock = 0;
	// The count-in's seconds arrive whole from a session: between two of them the shot runs on the frame clock.
	let counted: { left: number; at: number } | null = null;
	let shot: Hud['shot'] = null;
	function countingIn(): RevealView | null {
		const c = opts.countIn?.();
		if (!c || c.left <= 0) {
			shot = null;
			return (counted = null);
		}
		if (counted?.left !== c.left) counted = { left: c.left, at: wallClock };
		const left = Math.max(0, c.left - Math.min(1, wallClock - counted.at));
		const still = opts.steady?.() ?? false;
		shot = still || c.total - left >= c.total - HOLD_S ? 'still' : 'flying';
		return { left, total: c.total, still };
	}
	let sinceHud = HUD_EVERY;
	/** `wall` is the real time the frame took, unclamped: what the bunch is laid out by (#3098). */
	function advanceBy(seconds: number, wall = seconds) {
		if (!crew) return;
		// A moment holds: nothing it draws moves with the clock.
		const real = moment ? 0 : seconds;
		const dt = real * speedup;
		t += dt;
		wallClock += wall;
		sight.uTime.value += real;
		const n = Math.max(1, Math.ceil(dt / SUBSTEP));
		for (let k = 0; k < n; k++) advance(route, stepped, dt / n, t);
		const view = opts.bunch?.();
		if (bunch && view) ride(view, moment ? 0 : wall);
		else {
			if (opts.metre) follow(you, opts.metre(), real);
			// A race's racers (#3778): a session's world has a bunch but none in a race.
			if (alongside) riders = alongside.step(you, opts.mates!(), real);
		}
		gates?.update(opts.gates!(), you.d);
		const me = crew.update(route, riders, pedal, dt, real, mode === 'orbit');
		crew.drive(route, car, mode === 'orbit');
		ghosts?.update(route, ghostsNow(real), dt, mode === 'orbit');
		if (controls) controls.update();
		else
			rig.update(
				camera,
				mode === 'orbit' ? 'chase' : mode,
				you,
				me,
				real,
				countingIn(),
			);
		game?.follow(camera.position);
		tags?.update(riders, (r) => crew!.at(r), camera, mode === 'orbit');
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
		chalk?.update(view.chalk ?? []);
		clock += real;
		const steady = opts.steady?.() ?? false;
		// A game's road first: who it has put out stands where it says (#3114).
		game?.update(view, clock, real, steady);
		const stands = game?.stands();
		const out = bunch!.step(view, real, Date.now(), stands);
		// The cowbell counts against the roadside's one ceiling, like any ring (SPEC "The roadside").
		if (game?.rang && roadsideSound(Date.now())) opts.onCue?.('cowbell');
		// A tick's cheers are heard once, however many frames read its view.
		const tick = view.at ?? view;
		if (tick !== heard) {
			heard = tick;
			for (const [id, at] of cheered)
				if (clock - at >= CHEER_S) cheered.delete(id);
			for (const id of view.cheered) cheered.set(id, clock);
		}
		const order = view.order.join('\n');
		if (order !== lookedAt) {
			lookedAt = order;
			looks = bunchLooks(
				view.order.map((id) => ({ id })),
				MOST_ABREAST,
			);
		}
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
				crewmates.set(p.id, r);
			}
			const who = view.present.get(p.id);
			Object.assign(r, {
				d: p.d,
				at: p.d,
				v: p.v,
				lane: p.lane,
				alpha: p.alpha,
				faded: p.faded,
				coach: p.coach,
				cheer: cheerOf(p.id, steady),
				stopped: stands?.has(p.id) ?? false,
				speaking: !!who?.speaking,
				level: who?.level,
				// One leaving keeps their look while they dither out.
				look: looks.get(p.id) ?? r.look,
				// A live zone where you may see their numbers (ADR-0059): a session's
				// riders in your channel, unless a game hides the meter; never a faded one.
				ring: !view.meterHidden && !p.faded,
			});
			if (r !== you && who?.name) r.name = who.name;
			if (r !== you) Object.assign(r, { watts: p.watts, ftp: p.ftp });
		}
		for (const id of crewmates.keys())
			if (!placed.has(id)) crewmates.delete(id);
		// Not in it — watching, or before the plan runs: you ride the ride's
		// metre, as alone, and wear no chevron the bunch did not give you. A
		// coach with no trainer drives the team car instead, so their own
		// figure is not drawn: the car is them (#3771).
		if (!placed.has(you.id)) {
			if (opts.metre) follow(you, opts.metre(), real);
			you.lane = undefined;
			you.alpha = out.car?.coach && view.coach === you.id ? 0 : undefined;
			you.coach = false;
			you.cheer = null;
		}
		riders = [you, ...crewmates.values()];
		car = out.car;
	}

	/** How a cheer for `id` looks now; null with none, or once it is over. */
	function cheerOf(id: string, steady: boolean) {
		const at = cheered.get(id);
		return at === undefined ? null : cheerLook(clock - at, steady);
	}

	/**
	 * The ground, the road and the dressing, brought to where the eye now is;
	 * the diorama holds still. A ride settles the dressing's tiles a few a
	 * frame (#3699); a held moment, and a camera moved by hand, all at once.
	 */
	function look(whole = !!moment) {
		if (!controls) stream.update(camera.position.x, camera.position.z);
		stage?.update(camera.position, whole);
	}

	dress(opts.style);
	if (moment) sight.uTime.value = moment.m / 10;
	advanceBy(0);

	return {
		scene,
		camera,
		dress,
		advanceBy,
		/**
		 * Everything that draws words (#4221): riders' names, the signs and
		 * arches with their places, chalk and gates. The ride's picture is
		 * drawn without them, so it carries no name.
		 */
		labels: (): THREE.Object3D[] =>
			[tags?.group, stage?.labels, chalk?.group, gates?.group].filter(
				(o): o is THREE.Object3D => !!o,
			),
		/** Brings the level of detail and the dressing to where the camera now stands, after moving it by hand (the scene budget does). */
		look: () => look(true),
		/** Your figure, the rider mask the GPU checks measure (#3222). */
		get you() {
			return crew?.you ?? null;
		},
		setCamera(next: CameraMode) {
			mode = next;
			applyMode();
		},
		setWatts(watts: number) {
			you.watts = watts;
		},
		setSilent(silent: boolean) {
			you.silent = silent;
		},
		setSpeedup(factor: number) {
			speedup = factor;
		},
		/** The ride's progress, 0–1, for the light; null when it has no known end (ADR-0072). */
		setProgress(p: number | null) {
			progress = p;
			light();
		},
		/** Nothing moves: a held moment, or you have stopped pedalling, every rider stands, nobody turns the model and no cheer blinks. */
		idle: () =>
			!!moment ||
			(!(opts.countIn?.() && !opts.steady?.()) &&
				you.watts === 0 &&
				!controls &&
				cheered.size === 0 &&
				riders.every((r) => r.v < 0.05)),
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
				// three caches a SkinnedMesh's box at the first call, in whatever pose it held then (#3211).
				figure.traverse((o) => {
					if ((o as THREE.SkinnedMesh).isSkinnedMesh)
						(o as THREE.SkinnedMesh).computeBoundingBox();
				});
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
			// Where a capture reads the near asphalt (#3674): 4 m ahead of your wheel, a metre right of its line, clear of the trail.
			let asphaltAt: [number, number] | null = null;
			const yours = figure?.parent;
			if (yours) {
				const here = at(route, you.d);
				const l = leftOf(here.heading);
				const lane =
					(yours.position.x - here.x) * l.lx +
					(yours.position.z - here.z) * l.lz -
					1;
				const ahead = at(route, you.d + 4);
				const la = leftOf(ahead.heading);
				const v = new THREE.Vector3(
					ahead.x + la.lx * lane,
					yOf(route, ahead.ele),
					ahead.z + la.lz * lane,
				).project(camera);
				if (Math.abs(v.x) < 1 && Math.abs(v.y) < 1) asphaltAt = [v.x, v.y];
			}
			return {
				asphaltAt,
				camera: {
					fov: Math.round(camera.fov * 100) / 100,
					at: camera.position.toArray().map((v) => Math.round(v * 10) / 10),
				},
				moment: moment ?? null,
				// What a capture waits on before it shoots: the ground around the eye, whole (#3699); and what the soak holds flat (#3851).
				ground: {
					pending: stream.pending(),
					held: stream.held().length,
					window: stream.window(),
				},
				/** Seconds of ride the sim has stepped, and your metres along the road: the soak's clock (#3851). */
				clock: t,
				d: you.d,
				figure: { bboxH, kitCollisions: crew?.kitCollisions() ?? 0 },
				/** Ghosts drawn, all in one instanced draw (#3245). */
				ghosts: ghosts?.shown ?? 0,
				ring: { bandM: RING_BAND_M },
				/** The blocks painted ahead (#3101): their words and metres ahead of you. */
				gates: (opts.gates?.() ?? []).map((g) => ({
					words: g.words,
					aheadM: Math.round(g.m - you.d),
				})),
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
