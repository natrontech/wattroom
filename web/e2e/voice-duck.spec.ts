import { expect, test, type BrowserContext } from '@playwright/test';
import { signInAs } from './signin';

/**
 * The seam nothing else covers (#1171, following a rider report and #1160 /
 * #1162): a REAL remote voice, through a real LiveKit connection, through a
 * real AudioWorkletNode, lighting the real speaking ring on another rider's
 * tile. speaking.test.ts, duck.test.ts and av.svelte.test.ts all prove the
 * JS around the meter is correct GIVEN a level — vitest's happy-dom has no
 * Web Audio API at all, so nothing anywhere had proven the meter itself
 * produces one from a real voice. It didn't: this test is how #1160 was
 * confirmed real and fixed (av-output.ts, `createMediaStreamSource` over
 * `createMediaElementSource`).
 *
 * Needs `make infra`'s LiveKit container (e2e/server.js passes the same
 * devkey/secret `make dev-server` uses) and a real microphone signal, so this
 * runs in its own Playwright project (playwright.config.ts) with Chromium's
 * fake-media flags.
 *
 * The signal itself is a SOUND, not a recording: `fakeMicrophone` below
 * overrides `getUserMedia` to hand back a live `OscillatorNode`'s output
 * (through a `MediaStreamAudioDestinationNode`) rather than pointing
 * Chromium's own `--use-file-for-fake-audio-capture` at a WAV. A generated
 * tone is guaranteed non-silent for as long as this page's Web Audio graph
 * keeps running; a looped file additionally depends on Chromium's fake
 * capture device correctly decoding and looping it, one more moving part
 * between "the test wrote a signal" and "the app received one".
 */

const A = 'Voice Dev A';
const B = 'Voice Dev B';

/**
 * Make `getUserMedia({ audio: … })` on this context return a live tone
 * instead of asking for real (or Chromium-faked) hardware — vibrato on a
 * sawtooth rather than a flat sine, so the signal has the amplitude and
 * harmonic variance a dead-flat test tone lacks, in case anything downstream
 * (WebRTC's own DTX included) leans on that to tell signal from silence.
 */
async function fakeMicrophone(ctx: BrowserContext): Promise<void> {
	await ctx.addInitScript(() => {
		const real = navigator.mediaDevices.getUserMedia.bind(
			navigator.mediaDevices,
		);
		navigator.mediaDevices.getUserMedia = async (constraints) => {
			if (!constraints?.audio) return real(constraints);
			const audioCtx = new AudioContext();
			const osc = new OscillatorNode(audioCtx, {
				type: 'sawtooth',
				frequency: 180,
			});
			const vibrato = new OscillatorNode(audioCtx, { frequency: 5 });
			const vibratoDepth = new GainNode(audioCtx, { gain: 40 });
			vibrato.connect(vibratoDepth).connect(osc.detune);
			const level = new GainNode(audioCtx, { gain: 0.5 });
			const dest = audioCtx.createMediaStreamDestination();
			osc.connect(level).connect(dest);
			osc.start();
			vibrato.start();
			return dest.stream;
		};
	});
}

test("a real remote voice lights the listener's speaking ring, and losing it clears the ring", async ({
	browser,
	baseURL,
}) => {
	test.skip(
		!!process.env.PLAYWRIGHT_BASE_URL,
		'the ?as= dev provider and make infra only exist against a local dev server',
	);
	// Well under the suite's 5-minute default: everything here is either a
	// join that resolves in seconds or an assertion with its own explicit
	// timeout, so a run still going at 60s is stuck, not slow — fail it
	// loudly rather than burning the shared budget finding that out.
	test.setTimeout(60_000);

	const aCtx = await browser.newContext({
		baseURL,
		permissions: ['microphone'],
	});
	const bCtx = await browser.newContext({
		baseURL,
		permissions: ['microphone'],
	});
	await fakeMicrophone(aCtx);
	await fakeMicrophone(bCtx);
	const a = await aCtx.newPage();
	const b = await bCtx.newPage();

	await signInAs(a, A, '/home#rooms');
	const name = `Voice Duck ${Date.now() % 100000}`;
	await a.locator('#open-room-name').fill(name);
	await a.getByRole('button', { name: 'Open room' }).click();
	await expect(
		a.getByRole('heading', { name }),
		`opening "${name}" never landed ${A} in the room`,
	).toBeVisible({ timeout: 20_000 });
	const slug = a.url().split('/r/')[1].split(/[/?#]/)[0];
	const code = await a.evaluate(
		(roomSlug) =>
			fetch(`/api/rooms/${roomSlug}`)
				.then((res) => res.json())
				.then((room) => String(room.code ?? '')),
		slug,
	);
	expect(code, `room ${slug} came back without a join code`).toMatch(
		/^[A-Z0-9]{6}$/,
	);

	try {
		await signInAs(b, B, '/home#rooms');
		await b.locator('#join-code').fill(code);
		await b.getByRole('button', { name: 'Join room' }).click();
		await expect(
			b.getByRole('heading', { name }),
			`${B} never landed in "${name}" after joining with the code ${code}`,
		).toBeVisible({ timeout: 20_000 });

		// ?voice=1 auto-joins once on mount (RoomShell.svelte) — it only does
		// anything once avEnabled is true, which is why e2e/server.js now
		// carries WATTROOM_LIVEKIT_*.
		await a.goto(`/r/${slug}?voice=1`);
		await b.goto(`/r/${slug}?voice=1`);
		await expect(
			a.getByRole('button', { name: 'mute microphone' }),
			`${A} never finished joining voice with an open mic`,
		).toBeVisible({ timeout: 20_000 });
		await expect(
			b.getByRole('button', { name: 'mute microphone' }),
			`${B} never finished joining voice with an open mic`,
		).toBeVisible({ timeout: 20_000 });

		// A fresh navigation does not carry the "user activation" a prior
		// click left on the page it replaced, so remote playback can start
		// blocked (#645): av.svelte.ts's onFirstGesture listens for exactly
		// one event, `pointerdown` on `document`, and only that calls
		// room.startAudio() — the one thing that actually plays the LiveKit
		// audio elements a Web Audio tap reads from. A real click's own
		// actionability wait (visible, stable, unobscured, hit-testable) can
		// stall against a page mid-layout; dispatching the event directly,
		// the way av.svelte.test.ts's own "any first click unblocks it" test
		// already does, gets the one signal the app listens for with nothing
		// to resolve against.
		await a.evaluate(() => document.dispatchEvent(new Event('pointerdown')));
		await b.evaluate(() => document.dispatchEvent(new Event('pointerdown')));

		// B's fake microphone is already publishing a continuous tone. On A's
		// screen, B's tile should light the speaking ring (presence-marks.ts's
		// tileFrame) once that level reaches av.speaking through the real
		// meter — the exact path #1160 was reported broken.
		const bTile = a.getByTitle(`focus ${B}`).locator('div').first();
		await expect(
			bTile,
			`${B}'s tile never got the speaking ring on ${A}'s screen — the real remote-voice meter never reported a level`,
		).toHaveClass(/ring-z4/, { timeout: 20_000 });

		// Muting takes the level away — the ring has to follow it down, not
		// linger (#987: a rider who stops must not stay lit up forever).
		await b.getByRole('button', { name: 'mute microphone' }).click();
		await expect(
			bTile,
			`${B}'s tile stayed ringed as speaking after muting`,
		).not.toHaveClass(/ring-z4/, { timeout: 5_000 });
	} finally {
		const status = await a.evaluate(
			(roomSlug) =>
				fetch(`/api/rooms/${roomSlug}`, { method: 'DELETE' }).then(
					(res) => res.status,
				),
			slug,
		);
		expect(
			status,
			`room ${slug} survived the test — every leak counts against the owner's three-room cap`,
		).toBe(204);
		await aCtx.close();
		await bCtx.close();
	}
});
