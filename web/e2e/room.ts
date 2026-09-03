import {
	test as base,
	expect,
	type BrowserContext,
	type Page,
} from '@playwright/test';
import { signInTo } from './signin';

/** A room the test opened: where it lives, and how somebody else gets in. */
export interface OpenedRoom {
	slug: string;
	/** The six characters the join form takes — the code IS the invite. */
	code: string;
}

export interface RoomOwner {
	open(page: Page, name: string): Promise<OpenedRoom>;
}

/**
 * Two fixtures the room specs share: a signed-in rider, and a room whose
 * lifetime the FIXTURE owns rather than the happy path.
 *
 * Deleting the room in a `finally` only covers a failure inside the block. An
 * assertion that fails before it — or a timeout, or a crashed browser — leaks
 * the room, and three leaked rooms hit docs/SPEC.md's three-room ownership cap
 * and disable "Open room" for every later run (#594). Fixture teardown runs
 * whatever the test did, so the room goes back either way.
 *
 * `rooms` takes `riders` as a dependency purely for ordering: Playwright tears
 * fixtures down in reverse setup order, so the contexts the deletes are issued
 * from are guaranteed to still be open when they run.
 */
export const test = base.extend<{
	riders: (as?: string) => Promise<Page>;
	rooms: RoomOwner;
}>({
	riders: async ({ browser, baseURL }, use) => {
		const contexts: BrowserContext[] = [];
		await use(async (as) => {
			const context = await browser.newContext({ baseURL });
			contexts.push(context);
			// Mute before you play (AGENTS.md): a sprint fires the klaxon, the
			// gun and a fanfare out of whatever machine this happens to run on.
			await context.addInitScript(() =>
				localStorage.setItem(
					'wattroom.mixer.v1',
					JSON.stringify({ music: 0, cues: 0 }),
				),
			);
			const page = await context.newPage();
			if (as === undefined) {
				await signInTo(page, '/home#rooms');
				return page;
			}
			// ?as=<name> mints a second dev rider (#409) — the only way to put two
			// real sessions in one room. It is a redirect, not a button, so it
			// bypasses the login screen the default rider goes through.
			await page.goto(`/api/auth/dev/start?as=${encodeURIComponent(as)}`);
			const me = await page.evaluate(() =>
				fetch('/api/me').then((res) => (res.ok ? res.json() : null)),
			);
			expect(
				me?.displayName,
				`?as=${as} did not mint a second rider — is WATTROOM_DEV_LOGIN set on this server?`,
			).toBe(as);
			return page;
		});
		for (const context of contexts) await context.close();
	},

	rooms: async ({ riders: _riders }, use) => {
		const opened: { page: Page; slug: string }[] = [];
		await use({
			async open(page, name) {
				await page.locator('#open-room-name').fill(name);
				await page.getByRole('button', { name: 'Open room' }).click();
				await expect(
					page.getByRole('heading', { name }),
					`opening "${name}" never landed in the room — the owner is probably at the three-room cap (#594)`,
				).toBeVisible({ timeout: 15_000 });
				const slug = page.url().split('/r/')[1].split(/[/?#]/)[0];
				opened.push({ page, slug });
				const code = await page.evaluate(
					(roomSlug) =>
						fetch(`/api/rooms/${roomSlug}`)
							.then((res) => res.json())
							.then((room) => String(room.code ?? '')),
					slug,
				);
				expect(code, `room ${slug} came back without a join code`).toMatch(
					/^[A-Z0-9]{6}$/,
				);
				return { slug, code };
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

export { expect };
