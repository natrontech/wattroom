import { expect, test } from './crew';

/**
 * The sidebar's two folds share one x, and a voice channel's people indent
 * under its name (#4058): on the desk and on a ride, where `ride:hidden`
 * takes the desk's sentences out of the rows.
 */
test('the chevrons share an x and the people sit under the channel name', async ({
	riders,
	channels,
}) => {
	test.skip(
		!!process.env.PLAYWRIGHT_BASE_URL,
		'the ?as= dev provider only exists on a dev server',
	);
	const a = await riders('Aligned Here');
	await a.setViewportSize({ width: 1440, height: 900 });
	const opened = await channels.open(a, `Aligned ${Date.now() % 100000}`);
	const b = await riders('Aligned There');
	await channels.enter(b, opened);

	const nav = a.locator('nav[aria-label="crews and channels"]');
	await nav
		.getByRole('button', { name: /^Show who is in / })
		.click({ timeout: 15_000 });
	const person = nav.getByRole('list', { name: /^Who is in / }).locator('li');
	await expect(person.first()).toBeVisible();

	// x of the left edge of a row's first text, and the centre of a chevron.
	const measure = () =>
		a.evaluate(() => {
			const nav = document.querySelector(
				'nav[aria-label="crews and channels"]',
			)!;
			const fold = (el: Element | null) => {
				const r = el!.querySelector('svg')!.getBoundingClientRect();
				return r.left + r.width / 2;
			};
			const textLeft = (el: Element) => {
				const range = document.createRange();
				const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
				let n: Node | null;
				while ((n = w.nextNode()))
					if (n.textContent?.trim()) {
						range.selectNodeContents(n);
						return range.getBoundingClientRect().left;
					}
				throw new Error('no text');
			};
			const voiceFold = nav.querySelector('button[aria-label^="Hide who"]');
			const voiceName = voiceFold!.parentElement!.querySelector('a span')!;
			const heading = nav.querySelector(
				'button[aria-expanded][title*="conversations"]',
			);
			const who = nav.querySelector('ul[aria-label^="Who is in"] li')!;
			return {
				messagesFold: fold(heading),
				voiceFold: fold(voiceFold),
				name: textLeft(voiceName),
				person: textLeft(who),
			};
		});

	for (const ride of [false, true]) {
		if (ride) await a.evaluate(() => (document.body.dataset.ride = ''));
		const m = await measure();
		expect(
			Math.abs(m.messagesFold - m.voiceFold),
			`chevrons ${JSON.stringify(m)} ride=${ride}`,
		).toBeLessThanOrEqual(1);
		expect(
			Math.abs(m.person - m.name),
			`indent ${JSON.stringify(m)} ride=${ride}`,
		).toBeLessThanOrEqual(1);
	}
});
