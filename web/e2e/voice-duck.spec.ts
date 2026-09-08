import { expect, test } from '@playwright/test';
import { signInAs } from './signin';

/**
 * The seam nothing else covers (#1171, following a rider report and #1160 /
 * #1162): a REAL remote voice, through a real LiveKit connection, through a
 * real AudioWorkletNode, lighting the real speaking ring on another rider's
 * tile. speaking.test.ts, duck.test.ts and av.svelte.test.ts all prove the
 * JS around the meter is correct GIVEN a level — vitest's happy-dom has no
 * Web Audio API at all, so nothing anywhere has ever proven the meter itself
 * produces one from a real voice.
 *
 * Needs `make infra`'s LiveKit container (e2e/server.js passes the same
 * devkey/secret `make dev-server` uses) and a real microphone signal, so this
 * runs in its own Playwright project with Chromium's fake capture device —
 * looping e2e/fixtures/fake-voice.wav, a continuous tone rather than the fake
 * device's default mostly-silent beep pattern — and `--mute-audio` so a real
 * voice never reaches whatever speakers this happens to run near (AGENTS.md:
 * "Mute before you play").
 */

const A = 'Voice Dev A';
const B = 'Voice Dev B';

test("a real remote voice lights the listener's speaking ring, and losing it clears the ring", async ({
	browser,
	baseURL,
}) => {
	test.skip(
		!!process.env.PLAYWRIGHT_BASE_URL,
		'the ?as= dev provider and make infra only exist against a local dev server',
	);

	const aCtx = await browser.newContext({
		baseURL,
		permissions: ['microphone'],
	});
	const bCtx = await browser.newContext({
		baseURL,
		permissions: ['microphone'],
	});
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
		// click left on the page it replaced, so LiveKit's playback can start
		// blocked (#645, av.svelte.ts's "any first click unblocks it") — a
		// real click, not just being on the page, is what starts remote audio.
		await a.mouse.click(1, 1);
		await b.mouse.click(1, 1);

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
