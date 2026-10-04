// The ride world on a canvas. Owns the renderer and the loop: the sim, the
// camera rig, the riders and the trail advance only on frames it renders —
// 30 fps on the display's vsync divisor, one a second while nothing moves,
// none while a gate is shut (loop.ts). It builds no DOM — the caller hands it
// a canvas and takes it back on dispose. mount() throws when the scene will
// not start (no WebGL, most often), having released whatever it had made; a
// world that stops later — its context lost, its shaders refused — says so
// through onFail, once, and draws nothing more (ADR-0066: the fallback is
// one-way) — so does one that misses more than a fifth of its frames for ten
// seconds (docs/SPEC.md "The world", #3080).
import * as THREE from 'three';
import { pixelRatio } from './budget';
import { compose, type CameraMode, type MountOptions } from './compose';
import { createLoop, type LoopStats, missWatch, watchPage } from './loop';
import type { Failure } from './ride-view';
import type { Style } from './styles';

export type { CameraMode, Hud, MountOptions } from './compose';

export type WorldScene = {
	setStyle(style: Style): void;
	setCamera(mode: CameraMode): void;
	setWatts(watts: number): void;
	/** Your trainer is silent past SIGNAL_LOST_MS: the ring goes neutral and the trail stops until the next sample. */
	setSilent(silent: boolean): void;
	setSpeedup(factor: number): void;
	/** Hold the loop while a shared screen has the world's place, or the desktop shell hid its window. */
	hold(gate: 'displaced' | 'shell', held: boolean): void;
	/** Frames drawn and divisor intervals missed, for rideView() (#3080). */
	stats(): LoopStats;
	/** What a design capture measures (#3672): the composed scene's, and what the last frame drew. */
	probe(): ReturnType<ReturnType<typeof compose>['probe']> & {
		renderer: { draws: number; triangles: number };
	};
	dispose(): void;
};

const MAX_DT = 0.1; // the most one frame moves the ride on, after a stall

export function mount(
	canvas: HTMLCanvasElement,
	opts: MountOptions,
): WorldScene {
	const renderer = new THREE.WebGLRenderer({
		canvas,
		antialias: true,
		alpha: false,
		stencil: false,
		powerPreference: 'default', // never force a dual-GPU Mac onto its discrete GPU
	});
	renderer.toneMapping = THREE.NoToneMapping;
	renderer.shadowMap.enabled = false;
	let world: ReturnType<typeof compose>;
	try {
		world = compose(opts, canvas);
	} catch (err) {
		renderer.dispose();
		renderer.forceContextLoss(); // a scene that did not start holds no context either
		throw err;
	}
	const { scene, camera } = world;
	const dress = (style: Style) => {
		world.dress(style);
		renderer.setClearColor(style.sky.horizon);
	};
	renderer.setClearColor(opts.style.sky.horizon);

	function fit() {
		const w = canvas.clientWidth;
		const h = canvas.clientHeight;
		if (!w || !h) return;
		renderer.setPixelRatio(pixelRatio(w, h, window.devicePixelRatio));
		renderer.setSize(w, h, false);
		camera.aspect = w / h;
		camera.updateProjectionMatrix();
	}

	const loop = createLoop((seconds) => {
		// The bunch keeps the wall's time: where the hub has everyone does not wait for a slow frame.
		world.advanceBy(Math.min(seconds, MAX_DT), seconds);
		renderer.render(scene, camera);
	}, world.idle);
	let failed = false;
	function fail(why: Failure) {
		if (failed) return;
		failed = true;
		loop.stop();
		clearInterval(judge);
		opts.onFail?.(why);
	}
	const watch = missWatch();
	const judge = setInterval(() => watch(loop.stats()) && fail('frames'), 1000);
	const lost = () => fail('context-lost');
	function release() {
		world.dispose();
		renderer.dispose();
		renderer.forceContextLoss(); // stay clear of the browser's cap on live contexts
	}

	fit();
	const observer = new ResizeObserver(fit);
	observer.observe(canvas);
	canvas.addEventListener('webglcontextlost', lost);
	const unwatch = watchPage(canvas, loop.gate);
	// The shaders compile off the main thread where the driver allows, and
	// the first frame waits for them rather than stalling on them.
	renderer.compileAsync(scene, camera).then(
		() => failed || loop.start(),
		(err: unknown) => {
			console.error('world: the shaders did not compile', err);
			fail('build-failed');
		},
	);

	return {
		setStyle: dress,
		setCamera: (mode: CameraMode) => world.setCamera(mode),
		setWatts: (watts) => world.setWatts(watts),
		setSilent: (silent) => world.setSilent(silent),
		setSpeedup: (factor) => world.setSpeedup(factor),
		hold: loop.gate,
		stats: loop.stats,
		probe: () => ({
			...world.probe(),
			renderer: {
				draws: renderer.info.render.calls,
				triangles: renderer.info.render.triangles,
			},
		}),
		dispose() {
			failed = true; // what follows is ours, not a failure to report
			loop.stop();
			clearInterval(judge);
			unwatch();
			observer.disconnect();
			canvas.removeEventListener('webglcontextlost', lost);
			release();
		},
	};
}
