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
import { dioramaPass } from './diorama';
import { worldDiorama } from './mode';
import { DIORAMA, rampAll, WORDS } from './pixel';
import { drawSheets, SPRITE_LIGHT } from './rider-sprite';
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
import { fromAbove, pictureStill, wordless } from './picture-still';
import { PICTURE, type PictureMoment, type WorldShots } from './picture.svelte';
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
	 * The ride's pictures (#4221, #4263, #4431), the world's last frames: the
	 * loop stops, and the road at `at` is drawn again off-screen, once from
	 * the picture's own camera and once from the ride's heli camera, each at
	 * its own size, with nothing that carries a word, as JPEGs. Null where
	 * the browser gives none. Dispose after it.
	 */
	picture(at: PictureMoment): Promise<WorldShots | null>;
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
	const diorama = worldDiorama();
	// Before the crew is built: Diorama's riders are sprites (crew.ts).
	if (diorama) DIORAMA.value = 1;
	const renderer = new THREE.WebGLRenderer({
		canvas,
		// Diorama multisamples its own target (diorama.ts): the canvas gets only its pass and the words.
		antialias: !diorama,
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
		world = compose(
			{
				...opts,
				loungeLook: diorama
					? (opts.loungeLook ?? (() => undefined))
					: undefined,
			},
			canvas,
		);
	} catch (err) {
		renderer.dispose();
		renderer.forceContextLoss(); // a scene that did not start holds no context either
		throw err;
	}
	const { scene, camera } = world;
	camera.layers.enable(WORDS);
	const pass = diorama ? dioramaPass(renderer) : null;
	const draw = (s: THREE.Object3D, c: THREE.PerspectiveCamera) =>
		pass ? pass.render(s, c) : renderer.render(s, c);
	world.setFar(RUNGS[rung].far);
	// Behind the sky, the fog's colour: what the horizon is at this light.
	const clear = () => scene.fog && renderer.setClearColor(scene.fog.color);
	let style = opts.style;
	// The sprites take the look's key light, softened, and its haze (rider-sprite.ts).
	const light = (s: Style) => {
		SPRITE_LIGHT.light.value.set(s.key).lerp(new THREE.Color(1, 1, 1), 0.45);
		SPRITE_LIGHT.fog.value.set(s.sky.horizon);
		SPRITE_LIGHT.fogK.value = s.fogK;
	};
	const dress = (next: Style) => {
		style = next;
		world.dress(next);
		light(next);
		clear();
	};
	light(style);
	clear();

	function fit() {
		const w = canvas.clientWidth;
		const h = canvas.clientHeight;
		if (!w || !h) return;
		renderer.setPixelRatio(
			pixelRatio(w, h, window.devicePixelRatio, RUNGS[rung].pixels),
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
	const watching = () => (softwareDrawing() ? null : missWatch());
	let watch = watching();
	const judge = setInterval(() => {
		const stats = loop.stats();
		if (watch?.(stats)) {
			// Above the floor the Fallback is one more rung down, and the
			// watch starts over on it: only L1 hands the ride to the Skyline (#4423).
			if (!climbs || rung <= 1) return fail('frames');
			watch = watching();
			windowOf = windows();
			gpuMs = [];
			return climb((rung - 1) as Rung, 'slow');
		}
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
	// Into the target where Diorama draws: a program built for the screen's sRGB would build again on the first frame.
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
			// Diorama's riders are the room's sprites in the picture too, drawn whole before it is shot.
			const still = pictureStill(
				{
					...opts,
					style,
					loungeLook: diorama
						? (opts.loungeLook ?? (() => undefined))
						: undefined,
				},
				at,
			);
			drawSheets(Infinity);
			// Both pictures share one wait: the eye above stands 70 m back, mostly over ground already in.
			const until = performance.now() + PICTURE_WAIT_MS;
			async function shoot(width: number, height: number) {
				// The ground round the lens streams in like the ride's; the picture waits for it, whole.
				while (
					!broke &&
					still.probe().ground.pending > 0 &&
					performance.now() < until
				)
					await new Promise((done) => setTimeout(done, PICTURE_LOOK_MS));
				if (broke) return null;
				// Again for each: what the eye's move brought in carries words too.
				wordless(still.scene);
				renderer.setPixelRatio(1);
				renderer.setSize(width, height, false);
				if (still.scene.fog) renderer.setClearColor(still.scene.fog.color);
				draw(still.scene, still.camera);
				// Read in the same task as the render: the drawing buffer is not
				// kept past it (no preserveDrawingBuffer), and toBlob copies the
				// bitmap when it is called.
				return await new Promise<Blob | null>((done) =>
					canvas.toBlob(done, 'image/jpeg', PICTURE.quality),
				);
			}
			try {
				const rider = await shoot(PICTURE.width, PICTURE.height);
				// The second from the same still: the world is composed once, and only the camera cuts.
				fromAbove(still);
				const above = await shoot(PICTURE.above.width, PICTURE.above.height);
				return { rider, above };
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
