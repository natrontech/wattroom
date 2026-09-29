// The ride world on a canvas. Owns the renderer and the loop: the sim, the
// camera rig, the riders and the trail advance only on frames it renders,
// at 30 fps paced on vsync, and nothing runs while the tab is hidden. It
// builds no DOM — the caller hands it a canvas and takes it back on dispose.
// mount() throws when the scene will not start (no WebGL, most often), having
// released whatever it had made.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { pace, pixelRatio } from './budget';
import { makeCrew, type Crew, type Pedalling } from './crew';
import { disposeTree } from './dispose';
import { makeSight } from './materials';
import { makeRig, type Follow } from './rig';
import { type Route } from '$lib/road/route';
import { at } from '$lib/road/along';
import { advance, defaultRiders, trainerFor, type Env } from './sim';
import { buildStage, summitOf, type Stage } from './stage';
import type { Style } from './styles';
import type { World } from './world';

export type CameraMode = Follow | 'orbit';

export type Hud = {
	kmh: number;
	grade: number; // the road's, percent
	trainer: number; // what the trainer would be told, percent
	km: number;
	ele: number;
	toTop: number; // km to the summit, negative once past it
	riders: { id: string; name: string; you: boolean; d: number }[];
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
};

export type WorldScene = {
	setStyle(style: Style): void;
	setCamera(mode: CameraMode): void;
	setWatts(watts: number): void;
	setSpeedup(factor: number): void;
	dispose(): void;
};

const HUD_EVERY = 0.25; // seconds of real time between HUD snapshots
const SUBSTEP = 0.1; // sim seconds per integration step, so 16× does not tunnel through a crest
const MAX_DT = 0.1; // the most one frame moves the ride on, after a stall

export function mount(
	canvas: HTMLCanvasElement,
	opts: MountOptions,
): WorldScene {
	const { route, world } = opts;
	let mode: CameraMode = opts.camera ?? 'chase';
	let speedup = opts.speedup ?? 1;
	const env: Env = { difficulty: 0.5 };
	const riders = defaultRiders(opts.watts ?? 200, opts.ftp);
	const you = riders.find((r) => r.you) ?? riders[0];
	const pedal: Pedalling[] = riders.map(() => ({
		crank: 0,
		wheel: 0,
		stand: 0,
	}));
	const summit = world.markers.find((m) => m.kind === 'summit');

	const renderer = new THREE.WebGLRenderer({
		canvas,
		antialias: true,
		alpha: false,
		stencil: false,
		powerPreference: 'default', // never force a dual-GPU Mac onto its discrete GPU
	});
	renderer.toneMapping = THREE.NoToneMapping;
	renderer.shadowMap.enabled = false;
	const scene = new THREE.Scene();
	const camera = new THREE.PerspectiveCamera(52, 1, 0.5, 60000);
	const sight = makeSight();
	const rig = makeRig(route, world);
	let stage: Stage | null = null;
	let crew: Crew | null = null;
	let controls: OrbitControls | null = null;

	function applyMode() {
		const orbit = mode === 'orbit';
		if (stage) {
			stage.backdrop.visible = !orbit;
			stage.overview.visible = orbit;
		}
		if (orbit && !controls) {
			// Open on the whole model, tilted like a diorama on a table.
			const target = summitOf(route, world);
			camera.position.set(target.x + 8000, target.y + 7500, target.z + 9000);
			camera.lookAt(target);
			controls = new OrbitControls(camera, canvas);
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
		stage = buildStage(route, world, style, sight);
		crew = makeCrew(riders, style);
		scene.add(stage.group, crew.group);
		scene.fog = new THREE.FogExp2(style.sky.horizon, style.fogK * 1.1);
		renderer.setClearColor(style.sky.horizon);
		applyMode();
	}

	function fit() {
		const w = canvas.clientWidth;
		const h = canvas.clientHeight;
		if (!w || !h) return;
		renderer.setPixelRatio(pixelRatio(w, h, window.devicePixelRatio));
		renderer.setSize(w, h, false);
		camera.aspect = w / h;
		camera.updateProjectionMatrix();
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
			})),
		};
	}

	let t = 0;
	let sinceHud = HUD_EVERY;
	function advanceBy(real: number) {
		if (!crew) return;
		const dt = real * speedup;
		t += dt;
		sight.uTime.value += real;
		const n = Math.max(1, Math.ceil(dt / SUBSTEP));
		for (let k = 0; k < n; k++) advance(route, riders, dt / n, t);
		const me = crew.update(route, pedal, dt, real, mode === 'orbit');
		if (controls) controls.update();
		else rig.update(camera, mode === 'heli' ? 'heli' : 'chase', you, me, real);
		sight.uCam.value.copy(camera.position);
		sight.uYou.value.copy(me);
		sinceHud += real;
		if (sinceHud >= HUD_EVERY) {
			sinceHud = 0;
			opts.onTick?.(hud());
		}
	}

	let raf = 0;
	let running = false;
	let last = -1;
	let banked = 0;
	let since = 0;
	function frame(now: number) {
		raf = requestAnimationFrame(frame);
		const delta = last < 0 ? 0 : (now - last) / 1000;
		last = now;
		since += delta;
		const p = pace(banked, delta);
		banked = p.banked;
		if (!p.render) return;
		advanceBy(Math.min(since, MAX_DT));
		since = 0;
		renderer.render(scene, camera);
	}
	function start() {
		if (running || document.hidden) return;
		running = true;
		last = -1;
		since = 0;
		raf = requestAnimationFrame(frame);
	}
	function stop() {
		running = false;
		cancelAnimationFrame(raf);
	}
	const onVisibility = () => (document.hidden ? stop() : start());
	function release() {
		controls?.dispose();
		disposeTree(scene);
		renderer.dispose();
		renderer.forceContextLoss(); // stay clear of the browser's cap on live contexts
	}

	try {
		dress(opts.style);
		fit();
		advanceBy(0);
		renderer.render(scene, camera); // the first frame, before the loop's first tick
	} catch (err) {
		release(); // a scene that did not start holds no context either
		throw err;
	}
	const observer = new ResizeObserver(fit);
	observer.observe(canvas);
	document.addEventListener('visibilitychange', onVisibility);
	start();

	return {
		setStyle: dress,
		setCamera(next) {
			mode = next;
			applyMode();
		},
		setWatts(watts) {
			you.watts = watts;
		},
		setSpeedup(factor) {
			speedup = factor;
		},
		dispose() {
			stop();
			document.removeEventListener('visibilitychange', onVisibility);
			observer.disconnect();
			release();
		},
	};
}
