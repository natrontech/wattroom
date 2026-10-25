import { expect, test, voicePath } from './crew';
import { fakeMicrophone } from './fake-microphone';

/**
 * A voice through the local LiveKit, measured (#152, ADR-0088): two riders,
 * one tone, a minute of the listener's `getStats()`. Loopback has no network
 * to lose a packet, so whatever is lost, concealed or quiet here is ours.
 * The targets are docs/spec/voice.md's "Voice loopback".
 *
 * Runs in the `voice` project beside voice-duck.spec.ts, which owns the join
 * dance this repeats.
 */

const A = 'Voice Loop A';
const B = 'Voice Loop B';

const LISTEN_MS = 60_000;
const MAX_LOST = 0.01;
const MAX_CONCEALED = 0.02;

type Inbound = {
	packetsLost: number;
	packetsReceived: number;
	concealedSamples: number;
	totalSamplesReceived: number;
};

declare global {
	interface Window {
		__pcs: RTCPeerConnection[];
	}
}

test('a voice through the local LiveKit is RED, whole and audible for a minute', async ({
	riders,
	channels,
}) => {
	test.skip(
		!!process.env.PLAYWRIGHT_BASE_URL,
		'the ?as= dev provider and make infra only exist against a local dev server',
	);
	test.setTimeout(LISTEN_MS + 90_000);

	const a = await riders(A);
	const b = await riders(B);
	for (const rider of [a, b]) {
		await rider.context().grantPermissions(['microphone']);
		await fakeMicrophone(rider.context());
		// livekit-client keeps its peer connections to itself.
		await rider.context().addInitScript(() => {
			const Real = window.RTCPeerConnection;
			window.__pcs = [];
			window.RTCPeerConnection = class extends Real {
				constructor(config?: RTCConfiguration) {
					super(config);
					window.__pcs.push(this);
				}
			};
		});
	}

	const opened = await channels.open(a, `Voice Loop ${Date.now() % 100000}`);
	await channels.enter(b, opened);
	const voice = voicePath(opened);
	await a.goto(`${voice}?voice=1`);
	await b.goto(`${voice}?voice=1`);
	for (const [rider, name] of [
		[a, A],
		[b, B],
	] as const)
		await expect(
			rider.getByRole('button', { name: 'microphone', pressed: true }),
			`${name} never finished joining voice with an open mic`,
		).toBeVisible({ timeout: 20_000 });
	// The first gesture plays only the voices attached by then
	// (voice-duck.spec.ts, #1463): wait for B's on A's screen.
	await expect
		.poll(
			() =>
				a.evaluate(
					() =>
						[...document.querySelectorAll('audio')].filter(
							(el) => el.srcObject instanceof MediaStream,
						).length,
				),
			{ message: `${B}'s voice never reached ${A}'s screen`, timeout: 20_000 },
		)
		.toBe(1);
	for (const rider of [a, b])
		await rider.evaluate(() =>
			document.dispatchEvent(new Event('pointerdown')),
		);

	// The publisher sends RED over Opus (ADR-0043).
	await expect
		.poll(
			() =>
				b.evaluate(() =>
					window.__pcs
						.flatMap((pc) => pc.getSenders())
						.filter((s) => s.track?.kind === 'audio')
						.map((s) => s.getParameters().codecs?.[0]?.mimeType),
				),
			{ message: `${B}'s voice is not sent as RED`, timeout: 20_000 },
		)
		.toEqual(['audio/red']);

	const inbound = () =>
		a.evaluate(async () => {
			for (const pc of window.__pcs)
				for (const r of (await pc.getStats()).values())
					if (r.type === 'inbound-rtp' && r.kind === 'audio')
						return {
							packetsLost: r.packetsLost,
							packetsReceived: r.packetsReceived,
							concealedSamples: r.concealedSamples,
							totalSamplesReceived: r.totalSamplesReceived,
						} as Inbound;
			return null;
		});
	await expect
		.poll(inbound, {
			message: `${B}'s voice never reached ${A}`,
			timeout: 20_000,
		})
		.not.toBeNull();

	// Audible is the app's own meter: B's speaking ring (RMS ≥ 0.02) on A's
	// screen. getStats' audioLevel is taken after the <audio> element's
	// volume, which the app holds at 0 to play voices through its own bus.
	const ring = a.getByTitle(`focus ${B}`).locator('div').first();
	const quiet: number[] = [];
	let last: Inbound | null = null;
	for (let t = 5; t <= LISTEN_MS / 1000; t += 5) {
		await a.waitForTimeout(5_000);
		last = await inbound();
		if (!/outline-z4/.test((await ring.getAttribute('class')) ?? ''))
			quiet.push(t);
	}
	const s = last!;
	const lost = s.packetsLost / (s.packetsLost + s.packetsReceived);
	const concealed = s.concealedSamples / s.totalSamplesReceived;
	console.log(
		`over ${LISTEN_MS / 1000} s: ${s.packetsReceived} packets, ${(lost * 100).toFixed(2)} % lost, ` +
			`${(concealed * 100).toFixed(2)} % of samples concealed, unlit at ${quiet.join(', ') || 'no'} s`,
	);
	expect(lost, 'packets lost').toBeLessThanOrEqual(MAX_LOST);
	expect(concealed, 'samples concealed').toBeLessThanOrEqual(MAX_CONCEALED);
	expect(quiet, `${B}'s speaking ring went dark at these seconds`).toEqual([]);
});
