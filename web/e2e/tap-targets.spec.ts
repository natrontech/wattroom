import { expect, test } from './room';

/**
 * The kit's icon button, where a call site had typed its own (#2170).
 *
 * ux.md's floor is 24 CSS px on a browse surface (WCAG 2.2 SC 2.5.8); these
 * three were 15, 20 and 24, and the composer's two had each typed their own
 * skin, so a locked box dimmed one icon and not the other.
 */

/** This spec's own rider — nobody else's (#2133). */
const RIDER = 'Tap Target Rider';
const PHONE = { width: 375, height: 812 };
const FLOOR = 24;

/** What a control actually offers a thumb. */
async function box(
	locator: ReturnType<typeof test.step> extends never ? never : any,
) {
	const rect = await locator.boundingBox();
	return rect as { width: number; height: number };
}

test('the controls a rider taps on a browse surface clear the floor', async ({
	riders,
	rooms,
}) => {
	test.skip(
		!!process.env.PLAYWRIGHT_BASE_URL,
		'the ?as= dev provider only exists on a dev server',
	);

	const a = await riders(RIDER);
	// A friend, stubbed: the row's controls are the subject, and a real
	// friendship is friend-rows.spec.ts's (#2172).
	await a.route('**/api/friends', (route) =>
		route.fulfill({
			json: {
				code: 'TAPTAP',
				declines: [],
				friends: [
					{
						id: 'tap-target-peer',
						name: 'Tap Target Peer',
						status: 'accepted',
						at: Date.now(),
						totalXp: 100,
					},
				],
			},
		}),
	);

	await a.setViewportSize(PHONE);
	await a.goto('/friends');
	const message = a.getByRole('link', { name: 'message Tap Target Peer' });
	await expect(message).toBeVisible({ timeout: 15_000 });
	const messageBox = await box(message);
	expect(
		Math.min(messageBox.width, messageBox.height),
		`the one control that starts a DM is ${messageBox.width}×${messageBox.height}`,
	).toBeGreaterThanOrEqual(FLOOR);

	const copy = a.getByTitle('copy your friend code');
	const copyBox = await box(copy);
	expect(
		copyBox.height,
		`the code copy is ${copyBox.height}px tall`,
	).toBeGreaterThanOrEqual(FLOOR);

	// The composer's own two, in a real room's chat.
	const room = await rooms.open(a, `Tap Targets ${Date.now() % 100000}`);
	await a.goto(`/r/${room.slug}/chat`);
	const attach = a.getByRole('button', { name: 'attach an image' });
	await expect(attach).toBeVisible({ timeout: 15_000 });
	const attachBox = await box(attach);
	expect(
		Math.min(attachBox.width, attachBox.height),
		`attach is ${attachBox.width}×${attachBox.height}`,
	).toBeGreaterThanOrEqual(FLOOR);
});
