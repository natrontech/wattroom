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
import { LIGHT_PIXEL_BUDGET, pixelRatio } from './budget';
import { compose, type CameraMode, type MountOptions } from './compose';
import { createLoop, type LoopStats, missWatch, watchPage } from './loop';
import { softwareDrawing } from './software-drawing';
import { pictureStill, wordless } from './picture-still';
import { PICTURE, type PictureMoment } from './picture.svelte';
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
	/** The ride's progress, 0–1, for the light; null when it has no known end. */
	setProgress(p: number | null): void;
	/** Hold the loop while a shared screen has the world's place, or the desktop shell hid its window. */
	hold(gate: 'displaced' | 'shell', held: boolean): void;
	/** Frames drawn and divisor intervals missed, for rideView() (#3080). */
	stats(): LoopStats;
	/** What a design capture measures (#3672): the composed scene's, and what the last frame drew. */
	probe(): ReturnType<ReturnType<typeof compose>['probe']> & {
		renderer: {
			draws: number;
			triangles: number;
			geometries: number;
			textures: number;
			programs: number;
			/** Pixels drawn per CSS pixel (#4256): never under 1 where the device has them. */
			pixelRatio: number;
		};
	};
	/** A dev build's frames since the last call: when each began and its JS ms, for the soak (#3851). Always empty in a built app. */
	frames(): Frame[];
	/**
	 * The ride's picture (#4221, #4263), the world's last frame: the loop
	 * stops, and the road at `at` is drawn again off-screen at the picture's
	 * own size, from its own camera, with nothing that carries a word, as a
	 * JPEG. Null where the browser gives none. Dispose after it.
	 */
	picture(at: PictureMoment): Promise<Blob | null>;
	dispose(): void;
};

/** The most a picture waits for its ground to stream in, in frames: about 10 s at 60 Hz. */
const PICTURE_WAIT_FRAMES = 600;
const MAX_DT = 0.1; // the most one frame moves the ride on, after a stall
/** Frames kept for frames() between two reads: a minute at 30 fps, then the oldest go. */
const FRAMES_KEPT = 1800;

type Frame = { at: number; ms: number };

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
	// Behind the sky, the fog's colour: what the horizon is at this light.
	const clear = () => scene.fog && renderer.setClearColor(scene.fog.color);
	let style = opts.style;
	const dress = (next: Style) => {
		style = next;
		world.dress(next);
		clear();
	};
	clear();

	function fit() {
		const w = canvas.clientWidth;
		const h = canvas.clientHeight;
		if (!w || !h) return;
		renderer.setPixelRatio(
			pixelRatio(
				w,
				h,
				window.devicePixelRatio,
				opts.light ? LIGHT_PIXEL_BUDGET : undefined,
			),
		);
		renderer.setSize(w, h, false);
		camera.aspect = w / h;
		camera.updateProjectionMatrix();
	}

	let frames: Frame[] = [];
	const loop = createLoop((seconds) => {
		const at = performance.now();
		// The bunch keeps the wall's time: where the hub has everyone does not wait for a slow frame.
		world.advanceBy(Math.min(seconds, MAX_DT), seconds);
		renderer.render(scene, camera);
		if (import.meta.env.DEV) {
			frames.push({ at, ms: performance.now() - at });
			if (frames.length > FRAMES_KEPT) frames.shift();
		}
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
	const judge = softwareDrawing()
		? undefined
		: setInterval(() => watch(loop.stats()) && fail('frames'), 1000);
	let gone = false;
	const lost = () => {
		gone = true;
		fail('context-lost');
	};
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
		setProgress(p) {
			world.setProgress(p);
			clear();
		},
		hold: loop.gate,
		stats: loop.stats,
		probe: () => ({
			...world.probe(),
			renderer: {
				draws: renderer.info.render.calls,
				triangles: renderer.info.render.triangles,
				geometries: renderer.info.memory.geometries,
				textures: renderer.info.memory.textures,
				programs: renderer.info.programs?.length ?? 0,
				pixelRatio: renderer.getPixelRatio(),
			},
		}),
		frames() {
			const out = frames;
			frames = [];
			return out;
		},
		async picture(at) {
			failed = true; // the world's last frame was drawn: what follows is not a failure to report
			loop.stop();
			clearInterval(judge);
			if (gone) return null;
			const still = pictureStill({ ...opts, style }, at);
			try {
				// The ground round the lens streams in like the ride's; the picture waits for it, whole.
				for (
					let k = 0;
					k < PICTURE_WAIT_FRAMES && still.probe().ground.pending > 0;
					k++
				)
					await new Promise((done) => requestAnimationFrame(done));
				if (gone) return null;
				wordless(still.scene);
				renderer.setPixelRatio(1);
				renderer.setSize(PICTURE.width, PICTURE.height, false);
				if (still.scene.fog) renderer.setClearColor(still.scene.fog.color);
				renderer.render(still.scene, still.camera);
				// Read in the same task as the render: the drawing buffer is not
				// kept past it (no preserveDrawingBuffer), and toBlob copies the
				// bitmap when it is called.
				return await new Promise<Blob | null>((done) =>
					canvas.toBlob(done, 'image/jpeg', PICTURE.quality),
				);
			} finally {
				still.dispose();
			}
		},
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
