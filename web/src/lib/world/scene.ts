// The ride world on a canvas. Owns the renderer and the loop: the sim, the
// camera rig, the riders and the trail advance only on frames it renders —
// 30 fps on the display's vsync divisor, one a second while nothing moves,
// none while a gate is shut (loop.ts). It builds no DOM — the caller hands it
// a canvas and takes it back on dispose. mount() throws when the scene will
// not start (no WebGL, most often), having released whatever it had made; a
// world that stops later — its context lost, its shaders refused — says so
// through onFail, once, and draws nothing more (ADR-0066: the fallback is
// one-way) — so does one that misses more than a fifth of its frames for ten
// seconds (docs/SPEC.md "The world", #3080). Short of that, a ride's world
// climbs down the quality ladder (quality.ts, #3295).
import * as THREE from 'three';
import { pixelRatio } from './budget';
import { compose, type CameraMode, type MountOptions } from './compose';
import { createLoop, type LoopStats, missWatch, watchPage } from './loop';
import { softwareDrawing } from './software-drawing';
import { gpuTimer } from './gpu-timer';
import { worldPixels } from './mode';
import { pixelPass, rampAll, WORDS } from './pixel';
import {
	deviceKey,
	type Ladder,
	type Measured,
	rememberedRung,
	rememberRung,
	type Rung,
	RUNGS,
	startRung,
	stepped,
	TOP_RUNG,
	windows,
} from './quality';
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

/** The most a picture waits for its ground to stream in, and how often it looks: a hidden tab runs no frames, so it waits on the clock. */
const PICTURE_WAIT_MS = 10_000;
const PICTURE_LOOK_MS = 50;
const MAX_DT = 0.1; // the most one frame moves the ride on, after a stall
/** Frames kept for frames() between two reads: a minute at 30 fps, then the oldest go. */
const FRAMES_KEPT = 1800;

type Frame = { at: number; ms: number };

/** What the ladder remembers a device by: its GPU as the browser names it. */
function rendererName(gl: WebGL2RenderingContext): string {
	const info = gl.getExtension('WEBGL_debug_renderer_info');
	return String(
		gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER),
	);
}

export function mount(
	canvas: HTMLCanvasElement,
	opts: MountOptions,
): WorldScene {
	// Pixel 3D draws its own edges, one pixel wide: no multisampling to pay for.
	const pixels = worldPixels();
	const renderer = new THREE.WebGLRenderer({
		canvas,
		antialias: !pixels,
		alpha: false,
		stencil: false,
		powerPreference: 'default', // never force a dual-GPU Mac onto its discrete GPU
	});
	renderer.toneMapping = THREE.NoToneMapping;
	renderer.shadowMap.enabled = false;
	const gl = renderer.getContext() as WebGL2RenderingContext;
	// The quality ladder (#3295): a ride's world starts where this device was
	// left, Light at L1 and never higher, any other world at the top.
	const climbs = !!opts.onRung && !opts.light;
	const device = climbs
		? deviceKey(rendererName(gl), canvas.clientWidth, canvas.clientHeight)
		: '';
	let rung: Rung = opts.light
		? 1
		: (climbs && rememberedRung(device)) || TOP_RUNG;
	let world: ReturnType<typeof compose>;
	try {
		world = compose(opts, canvas);
	} catch (err) {
		renderer.dispose();
		renderer.forceContextLoss(); // a scene that did not start holds no context either
		throw err;
	}
	const { scene, camera } = world;
	camera.layers.enable(WORDS);
	const pass = pixels ? pixelPass(renderer) : null;
	const draw = (s: THREE.Object3D, c: THREE.PerspectiveCamera) =>
		pass ? pass.render(s, c) : renderer.render(s, c);
	// A canvas the browser scales blurs every world pixel: Pixel 3D's is drawn at the device's own, and never smoothed.
	if (pass) canvas.style.imageRendering = 'pixelated';
	world.setFar(RUNGS[rung].far);
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
		// Pixel 3D's scene is about 400 columns whatever the canvas: only its pass and its words draw at the device's pixels.
		renderer.setPixelRatio(
			pass
				? window.devicePixelRatio
				: pixelRatio(w, h, window.devicePixelRatio, RUNGS[rung].pixels),
		);
		renderer.setSize(w, h, false);
		camera.aspect = w / h;
		camera.updateProjectionMatrix();
	}

	let frames: Frame[] = [];
	const loop = createLoop((seconds) => {
		const at = performance.now();
		try {
			// The bunch keeps the wall's time: where the hub has everyone does not wait for a slow frame.
			world.advanceBy(Math.min(seconds, MAX_DT), seconds);
			timer?.begin();
			draw(scene, camera);
			timer?.end();
		} catch (err) {
			// A frame that throws throws every frame after it: a frozen world
			// the miss watch never sees, since each one counts as drawn.
			console.error('world: a frame failed', err);
			return fail('build-failed');
		}
		if (climbs) measure();
		if (import.meta.env.DEV) {
			frames.push({ at, ms: performance.now() - at });
			if (frames.length > FRAMES_KEPT) frames.shift();
		}
	}, world.idle);
	let failed = false;
	function fail(why: Failure) {
		if (failed) return;
		failed = true;
		broke = true;
		loop.stop();
		clearInterval(judge);
		opts.onFail?.(why);
	}

	// The ladder: the count-in's frames are the probe, and the ride's start
	// rung is decided as it ends; after that, every ten seconds of drawing is
	// a window that may step it down, never up.
	const timer = climbs ? gpuTimer(gl) : null;
	let probe: { from: LoopStats; gpuMs: number[] } | null = null;
	let probed = false;
	let gpuMs: number[] = [];
	let ladder: Ladder = { rung, strikes: 0 };
	let windowOf = windows();
	function climb(next: Rung, why: 'probe' | 'slow') {
		ladder = { rung: next, strikes: 0 };
		rememberRung(device, next);
		if (next !== rung) {
			rung = next;
			// Resizes the frame and shows or hides the far ring; nothing is rebuilt.
			fit();
			world.setFar(RUNGS[rung].far);
		}
		opts.onRung?.(next, why);
	}
	/** After each frame: its GPU time, and the count-in's probe while it lasts. */
	function measure() {
		const times = timer?.read() ?? [];
		if (!probed && (opts.countIn?.()?.left ?? 0) > 0) {
			probe ??= { from: loop.stats(), gpuMs: [] };
			probe.gpuMs.push(...times);
			return;
		}
		gpuMs.push(...times);
		if (!probe || probed) return;
		probed = true;
		const now = loop.stats();
		const measured: Measured = {
			rendered: now.rendered - probe.from.rendered,
			missed: now.missed - probe.from.missed,
			gpuMs: probe.gpuMs,
		};
		windowOf = windows();
		gpuMs = [];
		climb(startRung(measured, rung), 'probe');
	}
	// A dev build drawing in software keeps its world (software-drawing.ts); the ladder still climbs down.
	const watch = softwareDrawing() ? null : missWatch();
	const judge = setInterval(() => {
		const stats = loop.stats();
		if (watch?.(stats)) return fail('frames');
		if (!climbs || (probe && !probed)) return;
		const w = windowOf(stats, gpuMs.splice(0));
		if (!w) return;
		ladder = stepped(ladder, w);
		if (ladder.rung !== rung) climb(ladder.rung, 'slow');
	}, 1000);
	// A world that stopped (its context lost, or too slow to keep up) draws no picture either.
	let broke = false;
	const lost = () => fail('context-lost');
	function release() {
		canvas.style.imageRendering = '';
		world.dispose();
		pass?.dispose();
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
	// Into the target where Pixel 3D draws: a program built for the screen's sRGB would build again on the first frame.
	if (pass) rampAll(scene);
	if (pass) renderer.setRenderTarget(pass.sized());
	const compiled = renderer.compileAsync(scene, camera);
	renderer.setRenderTarget(null);
	compiled.then(
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
			if (broke) return null;
			const still = pictureStill({ ...opts, style }, at);
			try {
				// The ground round the lens streams in like the ride's; the picture waits for it, whole.
				const until = performance.now() + PICTURE_WAIT_MS;
				while (still.probe().ground.pending > 0 && performance.now() < until)
					await new Promise((done) => setTimeout(done, PICTURE_LOOK_MS));
				if (broke) return null;
				wordless(still.scene);
				renderer.setPixelRatio(1);
				renderer.setSize(PICTURE.width, PICTURE.height, false);
				if (still.scene.fog) renderer.setClearColor(still.scene.fog.color);
				draw(still.scene, still.camera);
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
