import { expect, test, type Page } from '@playwright/test';
import { CUES, type Cue } from '../src/lib/sound/cue-catalogue';
import { makeLimiter, scheduleVoices } from '../src/lib/sound/cue-graph';

/**
 * The mix, measured (#3353, the machine half of #152's listening pass).
 *
 * vitest's happy-dom has no Web Audio at all, so the cues are rendered here, in
 * Chromium's own OfflineAudioContext — through the very functions cues.ts
 * plays them with, loaded into the page by their source (cue-graph.ts keeps
 * them import-free for exactly this). Offline rendering reaches no speaker,
 * and this project launches muted besides.
 *
 * Loudness is BS.1770's: K-weighted (its two pre-filters as Web Audio
 * biquads), the loudest 400 ms momentary window. A cue shorter than the window
 * is measured over the whole window, which is what a short blip sounds like.
 */

// The loudest a board clip can be: a clip gain at its ceiling (docs/SPEC.md
// "Soundboard": 12 dB either way — server/internal/board MaxGainDb) on a rider
// fader at its ceiling (×2, RIDER_GAIN_MAX in mixer.svelte.ts).
const CLIP_GAIN_MAX_DB = 12;
const RIDER_GAIN_MAX = 2;
const BOARD_WORST = RIDER_GAIN_MAX * 10 ** (CLIP_GAIN_MAX_DB / 20);

type Measured = { id: string; peakDb: number; loudness: number };

declare global {
	interface Window {
		makeLimiter: typeof makeLimiter;
		scheduleVoices: typeof scheduleVoices;
	}
}

async function loadGraph(page: Page): Promise<void> {
	await page.addScriptTag({
		content: `window.makeLimiter = ${makeLimiter};\nwindow.scheduleVoices = ${scheduleVoices};`,
	});
}

function measureCues(page: Page): Promise<Measured[]> {
	return page.evaluate(async (cues: Cue[]) => {
		const RATE = 48000;
		const rows: Measured[] = [];
		for (const cue of cues) {
			const seconds = Math.max(
				0.5,
				Math.max(...cue.voices.map((v) => v.at + v.dur)) + 0.05,
			);
			const ctx = new OfflineAudioContext(2, Math.ceil(seconds * RATE), RATE);
			const sum = ctx.createGain();
			window.scheduleVoices(ctx, sum, cue.voices, 0.01, 1);
			const shelf = new BiquadFilterNode(ctx, {
				type: 'highshelf',
				frequency: 1681.97,
				gain: 3.99984,
			});
			const highpass = new BiquadFilterNode(ctx, {
				type: 'highpass',
				frequency: 38.13,
				Q: 0.5003,
			});
			const split = ctx.createChannelMerger(2);
			sum.connect(split, 0, 0);
			sum.connect(shelf).connect(highpass).connect(split, 0, 1);
			split.connect(ctx.destination);
			const out = await ctx.startRendering();
			const raw = out.getChannelData(0);
			const k = out.getChannelData(1);
			let peak = 0;
			for (const x of raw) peak = Math.max(peak, Math.abs(x));
			const win = Math.round(0.4 * RATE);
			const hop = Math.round(0.1 * RATE);
			let loudest = 0;
			for (let s = 0; s + win <= k.length; s += hop) {
				let energy = 0;
				for (let i = s; i < s + win; i++) energy += k[i] * k[i];
				loudest = Math.max(loudest, energy / win);
			}
			rows.push({
				id: cue.id,
				peakDb: 20 * Math.log10(peak),
				loudness: -0.691 + 10 * Math.log10(loudest),
			});
		}
		return rows;
	}, Object.values(CUES));
}

/** Tukey's fences: the pack's own spread, with nothing chosen by hand. */
function fences(values: number[]) {
	const s = [...values].sort((a, b) => a - b);
	const at = (p: number) => {
		const i = (s.length - 1) * p;
		const lo = Math.floor(i);
		return s[lo] + (s[Math.ceil(i)] - s[lo]) * (i - lo);
	};
	const q1 = at(0.25);
	const q3 = at(0.75);
	return {
		median: at(0.5),
		lo: q1 - 1.5 * (q3 - q1),
		hi: q3 + 1.5 * (q3 - q1),
	};
}

test.describe('the mix', () => {
	test.beforeEach(async ({ page }) => {
		await loadGraph(page);
	});

	test('every cue sits inside the pack’s own loudness spread', async ({
		page,
	}) => {
		const rows = await measureCues(page);
		const spread = fences(rows.map((r) => r.loudness));
		console.log(
			`median ${spread.median.toFixed(1)} LUFS, fences ${spread.lo.toFixed(1)} … ${spread.hi.toFixed(1)}\n` +
				rows
					.map(
						(r) =>
							`${r.id.padEnd(12)} peak ${r.peakDb.toFixed(1).padStart(6)} dBFS  loudness ${r.loudness.toFixed(1).padStart(6)} LUFS`,
					)
					.join('\n'),
		);
		for (const r of rows) {
			expect(r.loudness, r.id).toBeGreaterThanOrEqual(spread.lo);
			expect(r.loudness, r.id).toBeLessThanOrEqual(spread.hi);
		}
	});

	test('every cue at once, with the board at its loudest, never passes 0 dBFS', async ({
		page,
	}) => {
		const peakDb = await page.evaluate(
			async ({ cues, board }) => {
				const RATE = 48000;
				const seconds = 1.5;
				const ctx = new OfflineAudioContext(1, seconds * RATE, RATE);
				// The cue fader at full, into the limiter the board shares (cues.ts).
				const master = ctx.createGain();
				const limiter = window.makeLimiter(ctx, ctx.destination);
				master.connect(limiter);
				for (const cue of cues)
					window.scheduleVoices(ctx, master, cue.voices, 0.01, 1);
				// A clip as dense as a clip can be: a full-scale square, played at the
				// loudest the board and the rider's fader allow.
				const clip = ctx.createBuffer(1, seconds * RATE, RATE);
				const data = clip.getChannelData(0);
				for (let i = 0; i < data.length; i++)
					data[i] = Math.floor(i / (RATE / 440)) % 2 ? 1 : -1;
				const source = new AudioBufferSourceNode(ctx, { buffer: clip });
				source.connect(new GainNode(ctx, { gain: board })).connect(limiter);
				source.start(0.01);
				const out = (await ctx.startRendering()).getChannelData(0);
				let peak = 0;
				for (const x of out) peak = Math.max(peak, Math.abs(x));
				return 20 * Math.log10(peak);
			},
			{ cues: Object.values(CUES), board: BOARD_WORST },
		);
		console.log(`cue and board master peak ${peakDb.toFixed(2)} dBFS`);
		expect(peakDb).toBeLessThanOrEqual(0);
	});

	test('a full-scale voice at the loudest fader never passes 0 dBFS', async ({
		page,
	}) => {
		// Voices have a context and a limiter of their own (av-output.ts); the
		// jukebox plays in YouTube's iframe, outside any graph of ours.
		const peakDb = await page.evaluate(async (gain) => {
			const RATE = 48000;
			const ctx = new OfflineAudioContext(1, RATE, RATE);
			const limiter = window.makeLimiter(ctx, ctx.destination);
			const voice = ctx.createBuffer(1, RATE, RATE);
			const data = voice.getChannelData(0);
			for (let i = 0; i < data.length; i++)
				data[i] = Math.floor(i / (RATE / 360)) % 2 ? 1 : -1;
			const source = new AudioBufferSourceNode(ctx, { buffer: voice });
			source.connect(new GainNode(ctx, { gain })).connect(limiter);
			source.start(0);
			const out = (await ctx.startRendering()).getChannelData(0);
			let peak = 0;
			for (const x of out) peak = Math.max(peak, Math.abs(x));
			return 20 * Math.log10(peak);
		}, RIDER_GAIN_MAX);
		console.log(`voice master peak ${peakDb.toFixed(2)} dBFS`);
		expect(peakDb).toBeLessThanOrEqual(0);
	});
});
