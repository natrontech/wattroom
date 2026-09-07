import { expect, test } from './room';
import { signInAs } from './signin';

test('opening room chat focuses its composer', async ({ page, rooms }) => {
	await page.addInitScript(() =>
		localStorage.setItem(
			'wattroom.mixer.v1',
			JSON.stringify({ music: 0, cues: 0, board: 0 }),
		),
	);
	await signInAs(page, 'Chat Focus', '/rooms');
	const name = `Chat Focus ${Date.now() % 100000}`;
	const { slug } = await rooms.open(page, name);
	await page.goto(`/r/${slug}/chat`);
	await expect(page.getByPlaceholder(`Message ${name}…`)).toBeFocused();
	await page.keyboard.type('ready to write');
	await expect(page.getByPlaceholder(`Message ${name}…`)).toHaveValue(
		'ready to write',
	);
});

test('DM entry and peer navigation focus the composer, polling preserves chosen focus', async ({
	page,
}) => {
	const peers = ['focus-alex', 'focus-sam'];
	await page.route('**/api/dms', (route) =>
		route.fulfill({
			json: {
				conversations: peers.map((peerId) => ({
					peerId,
					peerName: peerId,
					text: 'Hello',
					mine: false,
					at: Date.now(),
				})),
			},
		}),
	);
	let loads = 0;
	await page.route('**/api/dms/*', (route) => {
		loads++;
		return route.fulfill({ json: { messages: [] } });
	});
	await signInAs(page, 'DM Focus', `/messages/dm/${peers[0]}`);
	const composer = page.getByPlaceholder(/^Message /);
	await expect(composer).toBeFocused();
	await page
		.locator(`a[href="/messages/dm/${peers[1]}"]:visible`)
		.first()
		.click();
	await expect(page).toHaveURL(new RegExp(`/messages/dm/${peers[1]}$`));
	await expect(composer).toBeFocused();
	await page.keyboard.type('ready for Sam');
	await expect(composer).toHaveValue('ready for Sam');
	const attach = page.getByRole('button', {
		name: 'attach an image',
		exact: true,
	});
	await attach.focus();
	const before = loads;
	await expect.poll(() => loads, { timeout: 10_000 }).toBeGreaterThan(before);
	await expect(attach).toBeFocused();
});
