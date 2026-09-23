import {
	test as base,
	expect,
	type BrowserContext,
	type Page,
} from '@playwright/test';
import { signInAs } from './signin';

/** A text and a voice channel the test opened in its rider's crew. */
export interface OpenedChannels {
	/** The crew they are in — the rider's own. */
	crew: string;
	/** The six characters the join form takes: the crew's code (#1236). */
	code: string;
	text: string;
	voice: string;
	/** Both channels carry it. */
	name: string;
}

export interface ChannelOwner {
	/**
	 * A text and a voice channel of this name in the rider's own crew, and the
	 * rider standing in the voice one — where a room's link used to land.
	 */
	open(page: Page, name: string): Promise<OpenedChannels>;
	/** The way in for a second rider: the crew by its code, then the voice channel. */
	enter(page: Page, opened: OpenedChannels): Promise<void>;
}

/** Every plan on a crew's calendar, cancelled. */
async function cancelEveryPlan(page: Page, crew: string): Promise<void> {
	const refused = await page.evaluate(async (id) => {
		const { sessions } = (await fetch(`/api/crews/${id}/schedule`).then((res) =>
			res.json(),
		)) as { sessions?: { id: string }[] };
		const left: string[] = [];
		for (const plan of sessions ?? []) {
			const res = await fetch(`/api/crews/${id}/schedule/${plan.id}`, {
				method: 'DELETE',
			});
			if (!res.ok) left.push(`${plan.id}: ${res.status}`);
		}
		return left;
	}, crew);
	expect(refused, 'plans the crew would not give back').toEqual([]);
}

/**
 * Four fixtures the crew specs share: a signed-in rider, channels whose
 * lifetime the FIXTURE owns rather than the happy path, the crews those
 * channels live in — the list the two of them hand state back through — and
 * the plans on a crew's calendar (`schedules`).
 *
 * Deleting the channels in a `finally` only covers a failure inside the
 * block. An assertion that fails before it — or a timeout, or a crashed
 * browser — leaks them, and a crew holds a capped number of channels
 * (docs/SPEC.md), so leaks would disable "new channel" for every later run.
 * Fixture teardown runs whatever the test did.
 *
 * The crew itself is kept: each spec's rider founds one, the first time,
 * and reuses it on every later run. Founding is capped per rider and a crew
 * ends only on succession (docs/SPEC.md), so a crew per test would walk the
 * rider into the cap. A membership, though, would leak into the next spec
 * and the next run (#2133): `riders` hands every crew back at teardown.
 *
 * `channels` takes `riders` as a dependency purely for ordering: Playwright
 * tears fixtures down in reverse setup order, so the contexts the deletes are
 * issued from are still open when they run. A spec opening on the built-in
 * `page` gets the same guarantee by destructuring it FIRST —
 * `{ page, channels }` — since that is the order they are set up in.
 */
export const test = base.extend<{
	/** Every crew a test stood in, for `riders` to hand back. */
	crews: string[];
	riders: (as: string) => Promise<Page>;
	channels: ChannelOwner;
	/**
	 * A plan outlives the test that made it: it is the crew's now (ADR-0058),
	 * and `channels` keeps a rider's crew across runs — where a room used to
	 * take its plans with it. Left behind, a plan spoils the next run's empty
	 * state and walks the crew towards docs/SPEC.md's ceiling on planned
	 * sessions. So a calendar a test plans on is emptied twice: when the test
	 * takes it, for a run a crash cut short, and at teardown. Every rider here
	 * belongs to one spec, so everything on its crew's calendar is the spec's.
	 */
	schedules: { own(page: Page, crew: string): Promise<void> };
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
			// `share` — a shared screen's own sound — defaults to 1 (#990).
			await context.addInitScript(() =>
				localStorage.setItem(
					'wattroom.mixer.v1',
					JSON.stringify({ music: 0, cues: 0, board: 0, share: 0 }),
				),
			);
			const page = await context.newPage();
			// Every rider is named, and no name may be "Dev Rider" (auth.go):
			// the one shared identity is exactly what used to make a spec depend
			// on running before its neighbours (#2133). Plain /home: a hash
			// makes the page focus a field a microtask after mount (#1199).
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

	channels: async ({ riders: _riders, crews }, use) => {
		const made: { page: Page; id: string }[] = [];
		await use({
			async open(page, name) {
				const opened = await page.evaluate(async (channelName) => {
					const post = (path: string, json: unknown) =>
						fetch(path, {
							method: 'POST',
							headers: { 'content-type': 'application/json' },
							body: JSON.stringify(json),
						}).then(async (res) => ({
							status: res.status,
							body: await res.json(),
						}));
					const mine = await fetch('/api/crews').then((res) => res.json());
					let crew: string =
						mine.crews?.find((c: { role?: string }) => c.role === 'owner')
							?.id ?? '';
					if (!crew) {
						const me = await fetch('/api/me').then((res) => res.json());
						const founded = await post('/api/crews', {
							name: String(me.displayName),
						});
						if (founded.status !== 201)
							return { error: `founding: ${JSON.stringify(founded)}` };
						crew = founded.body.id;
					}
					const code = String(
						(await fetch(`/api/crews/${crew}`).then((res) => res.json()))
							.code ?? '',
					);
					const ids: Record<string, string> = {};
					for (const kind of ['text', 'voice']) {
						const res = await post(`/api/crews/${crew}/channels`, {
							kind,
							name: channelName,
						});
						if (res.status !== 201)
							return { crew, ids, error: `${kind}: ${JSON.stringify(res)}` };
						ids[kind] = res.body.id;
					}
					return { crew, code, ids };
				}, name);
				// The fixture owns whatever was made, landing or not.
				for (const id of Object.values(opened.ids ?? {}))
					made.push({ page, id });
				expect(
					opened.error,
					`opening "${name}" was refused — the crew is probably at its channel cap`,
				).toBeUndefined();
				crews.push(opened.crew!);
				expect(opened.code, 'the crew came back without a code').toMatch(
					/^[A-Z0-9]{6}$/,
				);
				const channels: OpenedChannels = {
					crew: opened.crew!,
					code: opened.code!,
					text: opened.ids!.text,
					voice: opened.ids!.voice,
					name,
				};
				await page.goto(voicePath(channels));
				await expect(
					page.getByRole('heading', { name }),
					`opening "${name}" never landed in its voice channel`,
				).toBeAttached({ timeout: 15_000 });
				return channels;
			},
			async enter(page, opened) {
				// Plain /home, for the reason `riders` gives above.
				await page.goto('/home');
				await page.locator('#join-code').fill(opened.code);
				await page.getByRole('button', { name: 'Join crew' }).click();
				await page.waitForURL(/\/crew\//, { timeout: 15_000 });
				await page.goto(voicePath(opened));
				await expect(
					page.getByRole('heading', { name: opened.name }),
					`never landed in "${opened.name}" through the crew's door`,
				).toBeAttached({ timeout: 15_000 });
			},
		});
		for (const { page, id } of made) {
			const status = await page.evaluate(
				(channel) =>
					fetch(`/api/channels/${channel}`, { method: 'DELETE' }).then(
						(res) => res.status,
					),
				id,
			);
			expect(
				status,
				`channel ${id} survived the test — every leak counts against the crew's channel cap`,
			).toBe(204);
		}
	},

	// After `channels` in setup, so torn down before it: the contexts and the
	// plans' channels still exist when the plans are cancelled.
	schedules: async ({ channels: _channels }, use) => {
		const owned: { page: Page; crew: string }[] = [];
		await use({
			async own(page, crew) {
				owned.push({ page, crew });
				await cancelEveryPlan(page, crew);
			},
		});
		for (const { page, crew } of owned) await cancelEveryPlan(page, crew);
	},
});

export { expect };

/** Where the opened voice channel is (#2449). */
export const voicePath = (opened: OpenedChannels) =>
	`/crew/${opened.crew}/v/${opened.voice}`;

/** Where the opened text channel is (#2448). */
export const textPath = (opened: OpenedChannels) =>
	`/crew/${opened.crew}/c/${opened.text}`;
