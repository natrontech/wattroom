import { writeFileSync } from 'node:fs';
import { expect, test, voicePath } from './crew';

/**
 * Measures what a call really hears (docs/RESEARCH.md §22): a WAV goes in as
 * Chromium's fake microphone, through the real chain and the local LiveKit, and
 * the listener's stream comes out as a WAV for `scripts/voice-measure.py`.
 *
 * Off unless VOICE_SCENE names a mix in VOICE_DIR. Synthetic signals only:
 * a call is never recorded (AGENTS.md).
 *
 *   VOICE_DIR=/tmp/x VOICE_SCENE=bike pnpm exec playwright test voice-measure
 */
const dir = process.env.VOICE_DIR ?? '';
const scene = process.env.VOICE_SCENE ?? '';
const label = process.env.VOICE_LABEL ?? 'run';
const LISTEN_MS = Number(process.env.VOICE_LISTEN_MS ?? 45_000);

declare global {
	interface Window {
		__tap: {
			pcs: RTCPeerConnection[];
			raw: MediaStream[];
			sent: MediaStream[];
			heard: { ctx: AudioContext; node: AudioNode; stream: MediaStream }[];
			gate: { t: number; level: number; open: boolean; threshold: number }[];
			chunks: Record<string, Float32Array[]>;
			rate: Record<string, number>;
			start(key: string, stream: MediaStream): Promise<void>;
			startOn(key: string, ctx: AudioContext, node: AudioNode): Promise<void>;
			wav(key: string): string;
		};
	}
}

function tap() {
	const Real = window.RTCPeerConnection;
	const t = {
		pcs: [] as RTCPeerConnection[],
		raw: [] as MediaStream[],
		sent: [] as MediaStream[],
		heard: [] as { ctx: AudioContext; node: AudioNode; stream: MediaStream }[],
		gate: [] as {
			t: number;
			level: number;
			open: boolean;
			threshold: number;
		}[],
		chunks: {} as Record<string, Float32Array[]>,
		rate: {} as Record<string, number>,
		async startOn(key: string, ctx: AudioContext, source: AudioNode) {
			const url = URL.createObjectURL(
				new Blob(
					[
						`registerProcessor('rec', class extends AudioWorkletProcessor {
							process(i) { const c = i[0] && i[0][0]; this.port.postMessage(c ? c.slice() : new Float32Array(128)); return true; }
						})`,
					],
					{ type: 'text/javascript' },
				),
			);
			await ctx.audioWorklet.addModule(url);
			const node = new AudioWorkletNode(ctx, 'rec');
			t.chunks[key] = [];
			t.rate[key] = ctx.sampleRate;
			node.port.onmessage = (e) => t.chunks[key].push(e.data);
			source.connect(node);
			const mute = ctx.createGain();
			mute.gain.value = 0;
			node.connect(mute).connect(ctx.destination);
			await ctx.resume();
		},
		async start(key: string, stream: MediaStream) {
			const ctx = new AudioContext({ sampleRate: 48_000 });
			await t.startOn(key, ctx, cmss.call(ctx, stream));
		},
		wav(key: string) {
			const all = t.chunks[key];
			const pcm = new Int16Array(all.length * 128);
			let at = 0;
			for (const c of all)
				for (const s of c)
					pcm[at++] = Math.max(-32768, Math.min(32767, s * 32768));
			const bytes = new Uint8Array(pcm.buffer);
			let bin = '';
			for (let i = 0; i < bytes.length; i += 0x8000)
				bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
			return btoa(bin);
		},
	};
	window.__tap = t;
	window.RTCPeerConnection = class extends Real {
		constructor(config?: RTCConfiguration) {
			super(config);
			t.pcs.push(this);
		}
	};
	const gum = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
	// Fake Input 1, never the default: the default takes the sample rate of
	// this machine's real default input, and a Bluetooth headset's is 16 kHz.
	navigator.mediaDevices.getUserMedia = async (c) => {
		if (!c?.audio) return gum(c);
		(await gum({ audio: true })).getTracks().forEach((track) => track.stop());
		const inputs = await navigator.mediaDevices.enumerateDevices();
		const fake = inputs.find((d) => d.label === 'Fake Audio Input 1');
		const audio = {
			...(c.audio as object),
			deviceId: { exact: fake?.deviceId },
		};
		const s = await gum({ audio });
		t.raw.push(s);
		return s;
	};
	const cmss = AudioContext.prototype.createMediaStreamSource;
	AudioContext.prototype.createMediaStreamSource = function (stream) {
		const node = cmss.call(this, stream);
		if (!t.raw.includes(stream)) t.heard.push({ ctx: this, node, stream });
		return node;
	};
	const cmsd = AudioContext.prototype.createMediaStreamDestination;
	AudioContext.prototype.createMediaStreamDestination = function () {
		const node = cmsd.call(this);
		t.sent.push(node.stream);
		return node;
	};
	const Worklet = window.AudioWorkletNode;
	window.AudioWorkletNode = class extends Worklet {
		constructor(
			c: BaseAudioContext,
			name: string,
			o?: AudioWorkletNodeOptions,
		) {
			super(c, name, o);
			if (name !== 'voice-gate') return;
			this.port.addEventListener('message', (e: MessageEvent) =>
				t.gate.push({ t: performance.now(), ...e.data }),
			);
		}
	};
}

function wavFile(b64: string, rate = 48_000): Buffer {
	const pcm = Buffer.from(b64, 'base64');
	const head = Buffer.alloc(44);
	head.write('RIFF', 0);
	head.writeUInt32LE(36 + pcm.length, 4);
	head.write('WAVEfmt ', 8);
	head.writeUInt32LE(16, 16);
	head.writeUInt16LE(1, 20);
	head.writeUInt16LE(1, 22);
	head.writeUInt32LE(rate, 24);
	head.writeUInt32LE(rate * 2, 28);
	head.writeUInt16LE(2, 32);
	head.writeUInt16LE(16, 34);
	head.write('data', 36);
	head.writeUInt32LE(pcm.length, 40);
	return Buffer.concat([head, pcm]);
}

if (scene)
	test.use({
		launchOptions: {
			args: [
				'--mute-audio',
				'--use-fake-ui-for-media-stream',
				'--use-fake-device-for-media-stream',
				`--use-file-for-fake-audio-capture=${dir}/${scene}.wav`,
				'--autoplay-policy=no-user-gesture-required',
			],
		},
	});

test.skip(!scene, 'VOICE_SCENE names the mix to measure');

test(`what the call hears: ${scene}`, async ({ riders, channels }) => {
	test.setTimeout(LISTEN_MS + 120_000);
	const a = await riders('Voice Measure A');
	const b = await riders('Voice Measure B');
	for (const rider of [a, b]) {
		await rider.context().grantPermissions(['microphone']);
		await rider.context().addInitScript(tap);
		if (process.env.VOICE_DENOISE === '0')
			await rider
				.context()
				.addInitScript(() =>
					localStorage.setItem(
						'wattroom.voice.v1',
						JSON.stringify({ denoise: false }),
					),
				);
	}
	const opened = await channels.open(a, `Measure ${Date.now() % 100000}`);
	await channels.enter(b, opened);
	const voice = voicePath(opened);
	await a.goto(`${voice}?voice=1`);
	await b.goto(`${voice}?voice=1`);
	const micB = b.getByRole('button', { name: 'microphone', pressed: true });
	await expect(micB).toBeVisible({ timeout: 20_000 });
	await micB.first().click(); // only A speaks
	await expect(
		a.getByRole('button', { name: 'microphone', pressed: true }),
	).toBeVisible({ timeout: 20_000 });
	// A's own mic reopening rebuilds nothing here, but a reconnect closes B's
	// graph, so only a running one counts.
	await expect
		.poll(
			() =>
				b.evaluate(
					() =>
						window.__tap.heard.filter((h) => h.ctx.state === 'running').length,
				),
			{ timeout: 20_000 },
		)
		.toBeGreaterThan(0);
	for (const rider of [a, b])
		await rider.evaluate(() =>
			document.dispatchEvent(new Event('pointerdown')),
		);

	await a.evaluate(async () => {
		const t = window.__tap;
		await t.start('raw', t.raw.at(-1)!);
		await t.start('sent', t.sent.at(-1)!);
	});
	await b.evaluate(async () => {
		const t = window.__tap;
		const h = t.heard.filter((x) => x.ctx.state === 'running').at(-1)!;
		await t.startOn('heard', h.ctx, h.node);
	});
	await a.waitForTimeout(LISTEN_MS);

	const stats = (rider: typeof a) =>
		rider.evaluate(async () => {
			const out: Record<string, unknown>[] = [];
			for (const pc of window.__tap.pcs)
				for (const r of (await pc.getStats()).values())
					if (
						r.kind === 'audio' ||
						r.type === 'codec' ||
						r.type === 'media-playout' ||
						(r.type === 'media-source' && r.kind === 'audio')
					)
						out.push(r);
			return {
				out,
				params: window.__tap.pcs
					.flatMap((pc) => pc.getSenders())
					.filter((s) => s.track?.kind === 'audio')
					.map((s) => s.getParameters()),
				settings: window.__tap.raw.at(-1)?.getAudioTracks()[0].getSettings(),
			};
		});
	const send = await stats(a);
	const receive = await stats(b);
	const gate = await a.evaluate(() => window.__tap.gate);
	const pre = `${dir}/out-${label}-${scene}`;
	const rates = await b.evaluate(() => window.__tap.rate);
	writeFileSync(
		`${pre}-raw.wav`,
		wavFile(await a.evaluate(() => window.__tap.wav('raw'))),
	);
	writeFileSync(
		`${pre}-sent.wav`,
		wavFile(await a.evaluate(() => window.__tap.wav('sent'))),
	);
	writeFileSync(
		`${pre}-heard.wav`,
		wavFile(await b.evaluate(() => window.__tap.wav('heard')), rates.heard),
	);
	writeFileSync(`${pre}.json`, JSON.stringify({ send, receive, gate, rates }));
});
