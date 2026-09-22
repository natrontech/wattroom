import {
	test as base,
	expect,
	type BrowserContext,
	type Page,
} from '@playwright/test';
import { signInAs } from './signin';

/** A room the test opened: where it lives, and how somebody else gets in. */
export interface OpenedRoom {
	slug: string;
	/** The crew it was opened in. */
	crew: string;
	/** The voice channel it became (#2436) — where #2449's page is. */
	voice: string;
	/** The six characters the join form takes — the CREW's code (#1236). */
	code: string;
	name: string;
}

export interface RoomOwner {
	open(page: Page, name: string): Promise<OpenedRoom>;
	/** Hand the fixture a room the test opened through a door of its own. */
	adopt(page: Page, slug: string): void;
	/** The way in for a second rider: the crew by its code, then the room. */
	enter(page: Page, room: OpenedRoom): Promise<void>;
}

/**
 * Three fixtures the room specs share: a signed-in rider, a room whose
 * lifetime the FIXTURE owns rather than the happy path, and the crews those
 * rooms live in — the list the two of them hand state back through.
 *
 * Deleting the room in a `finally` only covers a failure inside the block. An
 * assertion that fails before it — or a timeout, or a crashed browser — leaks
 * the room, and three leaked rooms hit docs/SPEC.md's three-room ownership cap
 * and disable "Open a room" for every later run (#594). Fixture teardown runs
 * whatever the test did, so the room goes back either way.
 *
 * A CREW leaks the same way and lives longer: it is founded with its owner's
 * first room and nothing ever deletes it, so a membership taken in one spec is
 * still there in the next spec and in the next RUN (#2133). `riders` therefore
 * gives every crew back at teardown, the way `rooms` gives the rooms back.
 *
 * `rooms` takes `riders` as a dependency purely for ordering: Playwright tears
 * fixtures down in reverse setup order, so the contexts the deletes are issued
 * from are guaranteed to still be open when they run — and the rooms are gone
 * before the leaves, which is what keeps a leave off "you own a room in this
 * crew". A spec opening on the built-in `page` gets the same guarantee by
 * destructuring it FIRST — `{ page, rooms }` — since that is the order they
 * are set up in.
 */
export const test = base.extend<{
	/** Every crew a room was opened into, for `riders` to hand back. */
	crews: string[];
	riders: (as: string) => Promise<Page>;
	rooms: RoomOwner;
}>({
	crews: async ({}, use) => {
		await use([]);
	},

	riders: async ({ browser, baseURL, crews }, use) => {
		const contexts: BrowserContext[] = [];
		const pages: Page[] = [];
		await use(async (as) => {
			const context = await browser.newContext({ baseURL });
			contexts.push(context);
			// Mute before you play (AGENTS.md): a sprint fires the klaxon, the
			// gun and a fanfare out of whatever machine this happens to run on.
			// ALL FOUR channels, because what is stored REPLACES what was
			// there: a channel left out comes back at its default, and
			// `share` — a shared screen's own sound — defaults to 1. That is
			// the same trap `board`'s 0.7 set in #990, one channel later.
			await context.addInitScript(() =>
				localStorage.setItem(
					'wattroom.mixer.v1',
					JSON.stringify({ music: 0, cues: 0, board: 0, share: 0 }),
				),
			);
			const page = await context.newPage();
			// Every rider is named, and no name may be "Dev Rider" (auth.go):
			// the one shared identity is exactly what used to make a spec depend
			// on running before its neighbours (#2133).
			//
			// Home, not `/home#rooms`: the hash makes the page focus its own
			// name field a microtask after mount (reveal.ts, #1199), and
			// Playwright types a `fill` into whatever is focused WHEN THE KEYS
			// ARRIVE — so a steal between the two put a room's name into the
			// section behind the sheet and left the sheet's own button
			// disabled for the whole five-minute timeout.
			await signInAs(page, as, '/home');
			pages.push(page);
			return page;
		});
		// Hand every crew back. A rider who is not in one gets 404 (a crew is
		// not public), its owner gets 400 (a crew is never ownerless), and
		// anything else is a membership that outlived the spec.
		const stuck: string[] = [];
		for (const page of pages) {
			for (const crewId of crews) {
				const status = await page.evaluate(
					(id) =>
						fetch(`/api/crews/${id}/leave`, { method: 'POST' }).then(
							(res) => res.status,
						),
					crewId,
				);
				if (![204, 400, 404].includes(status))
					stuck.push(`${crewId}: ${status}`);
			}
		}
		for (const context of contexts) await context.close();
		expect(
			stuck,
			'a rider stayed in a crew — the next spec, and the next run, meet a member where they expect a stranger (#2133)',
		).toEqual([]);
	},

	rooms: async ({ riders: _riders, crews }, use) => {
		const opened: { page: Page; slug: string }[] = [];
		await use({
			async open(page, name) {
				// Through the API, into the rider's own crew: a rider with no
				// crew is offered "Start a crew" now (#2480), not a room, and the
				// doors themselves have their own spec (rooms.spec.ts).
				const created = await page.evaluate(async (roomName) => {
					const res = await fetch('/api/rooms', {
						method: 'POST',
						headers: { 'content-type': 'application/json' },
						body: JSON.stringify({ name: roomName }),
					});
					return { status: res.status, body: await res.json() };
				}, name);
				expect(
					created.status,
					`opening "${name}" was refused: ${JSON.stringify(created.body)} — the owner is probably at the three-room cap (#594)`,
				).toBe(201);
				const slug: string = created.body.slug;
				// The fixture owns it from here, landing or not.
				opened.push({ page, slug });
				await page.goto(`/r/${slug}`);
				await expect(
					page.getByRole('heading', { name }),
					`opening "${name}" never landed in the room`,
				).toBeVisible({ timeout: 15_000 });
				const crew = await page.evaluate(async (roomSlug) => {
					const room = await fetch(`/api/rooms/${roomSlug}`).then((res) =>
						res.json(),
					);
					if (!room.crew?.id) return { id: '', code: '' };
					const full = await fetch(`/api/crews/${room.crew.id}`).then((res) =>
						res.json(),
					);
					return { id: String(room.crew.id), code: String(full.code ?? '') };
				}, slug);
				expect(
					crew.code,
					`room ${slug}'s crew came back without a code`,
				).toMatch(/^[A-Z0-9]{6}$/);
				crews.push(crew.id);
				// Every room becomes a text and a voice channel of its name
				// (ADR-0058); the voice one is the page the channel specs ride.
				const voice = await page.evaluate(
					async ({ crewId, roomName }) => {
						const list = await fetch(`/api/crews/${crewId}/channels`).then(
							(res) => res.json(),
						);
						const found = (
							list.channels as { id: string; kind: string; name: string }[]
						).find((c) => c.kind === 'voice' && c.name === roomName);
						return found?.id ?? '';
					},
					{ crewId: crew.id, roomName: name },
				);
				expect(voice, `room "${name}" has no voice channel`).not.toBe('');
				return { slug, crew: crew.id, voice, code: crew.code, name };
			},
			adopt(page, slug) {
				opened.push({ page, slug });
			},
			async enter(page, room) {
				// Plain /home, for the reason `riders` gives above.
				await page.goto('/home');
				await page.locator('#join-code').fill(room.code);
				await page.getByRole('button', { name: 'Join crew' }).click();
				await page.waitForURL(/\/crew\//, { timeout: 15_000 });
				await page.goto(`/r/${room.slug}`);
				await page.getByRole('button', { name: 'Walk in' }).click();
				await expect(
					page.getByRole('heading', { name: room.name }),
					`never landed in "${room.name}" through the crew's door`,
				).toBeVisible({ timeout: 15_000 });
			},
		});
		for (const { page, slug } of opened) {
			const status = await page.evaluate(
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
		}
	},
});

/**
 * Where the room's text channel is read (#2448): every room became a text
 * and a voice channel of its own name (ADR-0058), and a room made since gets
 * them when it is made. Found by name in the crew's list, which holds only
 * what the caller may enter — so it is also proof the caller may.
 */
export async function textChannelOf(
	page: Page,
	room: OpenedRoom,
): Promise<string> {
	const id = await page.evaluate(
		async ({ crew, name }) => {
			const res = await fetch(`/api/crews/${crew}/channels`);
			const body = (await res.json()) as {
				channels?: { id: string; kind: string; name: string }[];
			};
			return (
				body.channels?.find((c) => c.kind === 'text' && c.name === name)?.id ??
				''
			);
		},
		{ crew: room.crew, name: room.name },
	);
	expect(id, `room "${room.name}" has no text channel to read`).not.toBe('');
	return `/crew/${room.crew}/c/${id}`;
}

export { expect };

/** Where a room's voice channel is (#2449). */
export const voicePath = (room: OpenedRoom) =>
	`/crew/${room.crew}/v/${room.voice}`;
