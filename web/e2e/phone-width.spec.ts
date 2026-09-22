import { expect, test, type Page } from '@playwright/test';
import { MEASURED, MEASURED_BY_ID, MEASURED_SIGNED_OUT } from './routes.js';
import { signInAs } from './signin';

/**
 * Nothing outside a room may scroll sideways on a phone (#1008).
 *
 * The obvious assertion — `documentElement.scrollWidth <= clientWidth` — is
 * useless in this app, and measurably so: the shell wraps the page in
 * `overflow-hidden` columns, so a chart 307px wider than a 375px viewport left
 * the document at exactly 375 and the check green. The overflow is absorbed by
 * `[data-testid=page-body]`, which is therefore what has to be measured.
 *
 * A widget that genuinely needs to be wide — a table, a long row — wraps
 * itself in its own `overflow-x: auto` and does not widen the body, so this
 * stays true without exempting anything.
 */
const PHONE = { width: 375, height: 812 };

/**
 * A token with no break opportunity — a hash, a column name, a pasted URL —
 * rendered by MessageText, which draws room chat, DMs and /whats-new (#2400).
 *
 * Deliberately far longer than the 44-character identifier that shipped in
 * 2026.09.120 and pushed `page-body` 22px past a phone. The app loads no
 * webfonts, so a monospace run is whatever metric the machine resolves and
 * 44 characters is a different number of pixels on a runner than on a laptop
 * — the sweep below went green on CI while the page overflowed locally. At
 * this length no font makes it fit, so what is measured here cannot pass by
 * luck.
 */
const LONG_TOKEN = `wattroom_identities_${'0123456789abcdef'.repeat(6)}`;

/**
 * Which routes are measured, and why the rest are not, lives in `./routes.js`
 * beside the reconciliation that fails when the route tree grows past it
 * (#2386). The lists are still written by hand — that part is a decision — but
 * a route in neither of them no longer slips through unmeasured and unnoticed.
 */

test.use({ viewport: PHONE });

/**
 * A rider with no rides has no charts, and the charts are what overflowed.
 * Without this the spec passes against the very bug it exists to catch —
 * confirmed by running it against the unfixed code, where it went green.
 */
async function seedARide(page: Page): Promise<void> {
	const ok = await page.evaluate(async () => {
		const res = await fetch('/api/rides', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				workoutName: 'Phone Width Ride',
				// Parsed server-side and required to yield a segment, so it is a
				// real workout rather than an empty string.
				workoutJson: JSON.stringify({
					name: 'Phone Width Ride',
					author: 'e2e',
					steps: [{ type: 'steady', seconds: 120, target: 0.8 }],
				}),
				startedAt: new Date(Date.now() - 3_600_000).toISOString(),
				samples: Array.from({ length: 120 }, () => ({ watts: 200 })),
			}),
		});
		return res.ok;
	});
	if (!ok) throw new Error('could not seed a ride for the chart pages');
}

/**
 * And a rider with an empty music pool has no shelf row, which is the widest
 * thing on /music. Same trap as the ride above: without this the route sits in
 * ROUTES asserting nothing — confirmed by deleting the strip's `overflow-x-auto`
 * and watching the spec stay green.
 */
async function seedATaggedTrack(page: Page): Promise<void> {
	const ok: true | string = await page.evaluate(async () => {
		// MPEG 1 Layer III, 128 kbps at 44.1 kHz: a 417-byte frame, repeated.
		// The server measures the duration off these frames, so they have to be
		// real ones rather than a blob named .mp3.
		const frame = new Uint8Array(417);
		frame.set([0xff, 0xfb, 0x90, 0x00]);
		const mp3 = new Uint8Array(417 * 40);
		for (let i = 0; i < 40; i++) mp3.set(frame, i * 417);

		const upload = await fetch('/api/tracks?name=Phone%20Width.mp3', {
			method: 'POST',
			body: mp3,
		});
		if (!upload.ok) return `upload ${upload.status}`;
		const track = await upload.json();
		// Enough shelves to be wider than 375px several times over — the strip
		// has to be scrolling something for its own overflow to be tested.
		const patch = await fetch(`/api/tracks/${track.id}`, {
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				title: 'Phone Width',
				artist: '',
				album: '',
				bpm: null,
				tags: [
					'synthwave',
					'darksynth',
					'italo disco',
					'techno',
					'ambient',
					'warm up',
					'cool down',
					'threshold',
				],
			}),
		});
		return patch.ok ? true : `patch ${patch.status}`;
	});
	if (ok !== true) throw new Error(`could not seed a tagged track: ${ok}`);
}

/**
 * And a text channel is empty until somebody says something, so it would be
 * measured against a blank column. The line is a pasted token in a code span
 * and bare (#2400) — the shape that widened /whats-new, on the surface a
 * rider actually pastes into.
 *
 * Posted once: this rider's crew is stable across runs (signin.ts), and a
 * line per run would grow the channel forever.
 */
async function seedALongToken(page: Page, channel: string): Promise<void> {
	const ok = await page.evaluate(
		async ([channel, token]) => {
			const thread = (await (
				await fetch(`/api/channels/${channel}/chat`)
			).json()) as {
				messages?: { text?: string }[];
			};
			if (thread.messages?.some((m) => m.text?.includes(token))) return true;
			const res = await fetch(`/api/channels/${channel}/chat`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ text: `\`${token}\` and bare ${token}` }),
			});
			return res.ok;
		},
		[channel, LONG_TOKEN] as const,
	);
	if (!ok)
		throw new Error('could not paste a long token into the text channel');
}

/**
 * And Home's "What's next" is empty until something is planned, so /home used
 * to be measured with that section rendering one line of prose (#1693). Each
 * row is a workout name, a date, a crew name and a planner on a 375px column —
 * the widest thing on the page once it has content.
 *
 * Idempotent: this rider and its crew are stable across runs (signin.ts), and
 * a plan a run leaves behind would walk the crew into docs/SPEC.md's session
 * ceiling eventually.
 */
async function seedAPlannedSession(page: Page, crew: string): Promise<void> {
	const ok = await page.evaluate(async (crew) => {
		const mine = (await (await fetch('/api/schedule')).json()) as {
			sessions?: unknown[];
		};
		if (mine.sessions?.length) return true;
		const res = await fetch(`/api/crews/${crew}/schedule`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				workoutName: 'Phone Width Threshold Intervals',
				workoutJson: JSON.stringify({
					name: 'Phone Width Threshold Intervals',
					steps: [{ type: 'steady', seconds: 2400, target: 0.95 }],
				}),
				startsAt: new Date(Date.now() + 48 * 3600_000).toISOString(),
			}),
		});
		return res.ok;
	}, crew);
	if (!ok) throw new Error("could not plan a session for Home's What's next");
}

test('no page outside a room scrolls sideways on a phone', async ({
	page,
	browser,
	baseURL,
}) => {
	await signInAs(page, 'Phone Width', '/home');
	await seedARide(page);
	await seedATaggedTrack(page);

	// The crew's page (#1150, #1151) is reached by id, so it is found rather
	// than listed: the rider starts one crew (#2480) and keeps it.
	const crewId = await page.evaluate(async () => {
		const read = async () => {
			const res = await fetch('/api/crews');
			const body = (await res.json()) as {
				crews?: { id: string; role?: string }[];
			};
			return body.crews?.find((c) => c.role === 'owner')?.id ?? null;
		};
		// This rider is reused across runs (signin.ts), so the crew it starts
		// on the first run is found on every later one — never a second.
		const found = await read();
		if (found) return found;
		await fetch('/api/crews', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ name: 'Phone Width Crew' }),
		});
		return read();
	});
	// Its settings (#1237) and its door (#1236) hang off the same crew: the
	// settings are the owner's, which this rider is, and the door takes the
	// crew's code, which the crew payload carries for members.
	const crewCode = crewId
		? await page.evaluate(
				async (id) =>
					String(
						(
							(await (await fetch(`/api/crews/${id}`)).json()) as {
								code?: string;
							}
						).code ?? '',
					),
				crewId,
			)
		: '';
	// A text channel of that crew (#2448): a crew opens with one.
	const textChannel = crewId
		? await page.evaluate(async (id) => {
				const body = (await (
					await fetch(`/api/crews/${id}/channels`)
				).json()) as { channels?: { id: string; kind: string }[] };
				return body.channels?.find((c) => c.kind === 'text')?.id ?? '';
			}, crewId)
		: '';
	// The pages reached by an id rather than listed: your own rider page and
	// the ride seeded above — the two that carry the widest things a rider
	// sees outside a crew.
	// A friend and one line between you (#1819): the DM thread is the message
	// surface a rider most opens on a sofa, and nothing measured it. A second
	// rider in their own context accepts, so the thread is a real one.
	const peerContext = await browser.newContext({ baseURL });
	const peerPage = await peerContext.newPage();
	await signInAs(peerPage, 'Phone Width Peer', '/home');
	const peerId = await peerPage.evaluate(async () =>
		String(
			((await (await fetch('/api/me')).json()) as { id?: string }).id ?? '',
		),
	);
	const myId = await page.evaluate(async () =>
		String(
			((await (await fetch('/api/me')).json()) as { id?: string }).id ?? '',
		),
	);
	// By the peer's friend code: a request by id needs a shared room, and
	// these two have none — the code is how strangers become friends.
	const peerCode = await peerPage.evaluate(async () =>
		String(
			((await (await fetch('/api/friends')).json()) as { code?: string })
				.code ?? '',
		),
	);
	const asked = await page.evaluate(async (code) => {
		const res = await fetch('/api/friends', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ code }),
		});
		return `${res.status} ${await res.text()}`;
	}, peerCode);
	// 409 is "already" (#2216): these two riders are stable by name — a fresh
	// identity per run would grow the user table forever (signin.ts) — and a
	// friendship outlives the run, so the second run in one checkout finds
	// the one the first made. What matters is the end state, which the DM
	// below asserts: this is home-presence.spec.ts's rule, one file over.
	expect(asked, 'the friend request').toMatch(/^(2\d\d|409)/);
	const accepted = await peerPage.evaluate(async (id) => {
		const res = await fetch(`/api/friends/${id}/accept`, { method: 'POST' });
		return `${res.status} ${await res.text()}`;
	}, myId);
	// 404 is an accept for a friendship that is already accepted.
	expect(accepted, 'the peer accepting').toMatch(/^(2\d\d|404|409)/);
	// The line carries LONG_TOKEN twice, in a code span and bare: a rider pastes
	// a hash into a DM, and the thread must break it rather than widen the page
	// (#2400). A friendly sentence measured nothing a paragraph does not.
	const sent = await page.evaluate(
		async ([id, token]) => {
			const res = await fetch(`/api/dms/${id}`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					text: `a line wide enough to wrap on a phone, which it must, plus \`${token}\` and bare ${token}`,
				}),
			});
			return `${res.status} ${await res.text()}`;
		},
		[peerId, LONG_TOKEN] as const,
	);
	expect(sent, 'the first line').toMatch(/^2\d\d/);
	await peerContext.close();

	const byId = await page.evaluate(async () => {
		const me = (await (await fetch('/api/me')).json()) as { id?: string };
		const rides = (await (await fetch('/api/rides')).json()) as {
			rides?: { id: string }[];
		};
		return {
			me: me.id ?? '',
			ride: rides.rides?.[0]?.id ?? '',
			peer:
				(
					(await (await fetch('/api/dms')).json()) as {
						conversations?: { peerId: string }[];
					}
				).conversations?.[0]?.peerId ?? '',
		};
	});
	// Keyed by the pattern routes.ts lists, so the two cannot drift apart: a
	// by-id route filled in here and not listed there — or listed and never
	// filled in — fails the assertion below rather than going unmeasured. The
	// ids themselves are asserted non-empty just after, before the first goto.
	const byPattern: Record<string, string> = {
		'/u/[id]': `/u/${byId.me}`,
		'/history/[id]': `/history/${byId.ride}`,
		'/messages/dm/[peer]': `/messages/dm/${byId.peer}`,
		'/crew/[id]': `/crew/${crewId}`,
		'/crew/[id]/members': `/crew/${crewId}/members`,
		'/crew/[id]/settings': `/crew/${crewId}/settings`,
		'/crew/[id]/schedule': `/crew/${crewId}/schedule`,
		'/crew/[id]/c/[channel]': `/crew/${crewId}/c/${textChannel}`,
		'/crew/[id]/board': `/crew/${crewId}/board`,
		'/crew/[id]/workouts': `/crew/${crewId}/workouts`,
		'/c/[code]': `/c/${crewCode}`,
	};
	expect(
		Object.keys(byPattern).sort(),
		'the by-id routes measured here are the ones routes.ts lists',
	).toEqual([...MEASURED_BY_ID].sort());
	const routes = [...MEASURED, ...Object.values(byPattern)];
	// The id-reached pages are the point of the seeding above: a run where
	// none of them resolved would pass while asserting nothing about them.
	expect(byId, 'the seeded ride and your own page resolve').toEqual(
		expect.objectContaining({
			me: expect.stringMatching(/.+/),
			ride: expect.stringMatching(/.+/),
			peer: expect.stringMatching(/.+/),
		}),
	);
	// The crew's routes hang off locals the guard above cannot see,
	// so they needed their own (#2360): let `/api/crews` stop listing the crew
	// or `/api/crews/:id` stop carrying `code` and the crew page, its settings
	// and its door leave the measured list in silence. The code is checked by
	// shape rather than emptiness, the same `/^[A-Z0-9]{6}$/` room.ts asserts.
	expect(
		{ crewId: crewId ?? '', crewCode, textChannel },
		'the crew, its settings and its door resolve',
	).toEqual({
		crewId: expect.stringMatching(/.+/),
		crewCode: expect.stringMatching(/^[A-Z0-9]{6}$/),
		textChannel: expect.stringMatching(/.+/),
	});

	await seedAPlannedSession(page, crewId ?? '');
	await seedALongToken(page, textChannel);

	const wide: string[] = [];
	for (const route of routes) {
		await page.goto(route);
		const body = page.getByTestId('page-body');
		await expect(body).toBeVisible();
		// The charts size themselves from their measured container, so wait
		// for the excess to settle at zero rather than a fixed 300 ms; a page
		// that never settles is recorded with whatever it settled on.
		const excessOf = () =>
			body.evaluate((el) => el.scrollWidth - el.clientWidth);
		await expect
			.poll(excessOf, { timeout: 3_000 })
			.toBe(0)
			.catch(() => {});
		const excess = await excessOf();
		if (excess > 0) wide.push(`${route} overflows by ${excess}px`);
	}

	expect(wide, 'pages wider than a 375px phone').toEqual([]);
});

/**
 * The pages a rider meets first, and the ones most likely to be opened on a
 * phone from a pasted link or an alarm mail — reached signed out, so outside
 * the shell that gives everything else `page-body`. Out there the document is
 * the page, and the document's own width is the honest measure.
 */
test('the landing, the gate and recovery fit a phone', async ({ page }) => {
	const wide: string[] = [];
	for (const route of MEASURED_SIGNED_OUT) {
		await page.goto(route);
		const excessOf = () =>
			page.evaluate(
				() =>
					document.documentElement.scrollWidth -
					document.documentElement.clientWidth,
			);
		await expect
			.poll(excessOf, { timeout: 3_000 })
			.toBe(0)
			.catch(() => {});
		const excess = await excessOf();
		if (excess > 0) wide.push(`${route} overflows by ${excess}px`);
	}
	expect(wide, 'pages wider than a 375px phone').toEqual([]);
});

/**
 * The editor must not stack library-first on a phone (ux.md): the rider's
 * steps come before thirty library rows. Source order is what stacks.
 */
test('the workout editor puts the steps before the library on a phone', async ({
	page,
}) => {
	await signInAs(page, 'Phone Width', '/workouts/edit');
	// evaluateAll has no auto-waiting: read the order only once the editor
	// has drawn its columns, or CI reads an empty list (-1 < -1 is false).
	await expect(page.locator('h2', { hasText: /^library$/ })).toBeVisible();
	const headings = await page
		.locator('h2')
		.evaluateAll((all) => all.map((h) => h.textContent?.trim().toLowerCase()));
	expect(headings.indexOf('steps')).toBeGreaterThanOrEqual(0);
	expect(headings.indexOf('steps')).toBeLessThan(headings.indexOf('library'));
});

test('the rider page and the workouts search keep their width on a phone', async ({
	page,
}) => {
	await page.setViewportSize(PHONE);
	await signInAs(page, 'Phone Headers', '/u/me');

	// The name is the page: side by side with the avatar and the action, the
	// text column was ~90 px and the name broke in two (#2183).
	const name = page.getByRole('heading', { level: 1 });
	await expect(name).toBeVisible({ timeout: 15_000 });
	const title = await name.evaluate((el) => ({
		cut: el.scrollWidth - el.clientWidth,
		width: el.clientWidth,
	}));
	expect(title.cut, `the rider's name is cut by ${title.cut}px`).toBe(0);
	expect(
		title.width,
		`the rider's name is given ${title.width}px of a 375px phone`,
	).toBeGreaterThan(200);

	await page.goto('/workouts');
	const search = page.getByRole('searchbox', { name: 'Find a workout' });
	await expect(search).toBeVisible({ timeout: 15_000 });
	const box = (await search.boundingBox())!;
	expect(
		Math.round(box.width),
		`the search box is ${Math.round(box.width)}px wide`,
	).toBeGreaterThan(300);
});

/**
 * The changelog is rider-supplied text by another route: /whats-new renders
 * CHANGELOG.md through MessageText, the same component that draws chat
 * (#2400). 2026.09.120 shipped `wattroom_identities_plaintext_refresh_tokens`
 * — 44 characters, no break opportunity — and pushed page-body to 397 on a
 * 375px phone, with the sweep above green on CI the whole time.
 *
 * The changelog is intercepted rather than read: what today's file happens to
 * contain is not a guard, and LONG_TOKEN is wide enough that no font metric
 * makes it fit (see its comment). Bare and in a code span, because the run
 * that breaks has to be the whole of the message, not the backticks.
 */
test('a long token in the changelog does not widen the page', async ({
	page,
}) => {
	await page.route('**/changelog.md', (route) =>
		route.fulfill({
			status: 200,
			contentType: 'text/markdown',
			body: `# Changelog

## [Unreleased]

## [2026.09.120] - 2026-09-20

### Fixed

- The server now counts \`${LONG_TOKEN}\`, and bare ${LONG_TOKEN} in prose.
`,
		}),
	);

	await signInAs(page, 'Phone Width', '/whats-new');
	const body = page.getByTestId('page-body');
	await expect(body).toBeVisible();
	await expect(page.getByText('2026.09.120')).toBeVisible();

	const excess = await body.evaluate((el) => el.scrollWidth - el.clientWidth);
	expect(excess, `/whats-new overflows by ${excess}px`).toBe(0);
});
