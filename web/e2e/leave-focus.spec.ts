import { expect, test } from './crew';

/**
 * Backing out of "Leave the crew" puts a keyboard rider back on the button
 * they came from (#2888, L8-10; ux.md "Keyboard focus"). The button disables
 * itself while the ask is open, and a dialog closing onto a disabled control
 * handed focus to <body> — Tab then started again from the top of the page.
 */
test('cancelling the leave keeps focus on its button', async ({
	riders,
	channels,
}) => {
	const owner = await riders('Leave Focus Owner');
	const theirs = await channels.open(
		owner,
		`Leave Focus ${Date.now() % 100000}`,
	);
	const rider = await riders('Leave Focus Rider');
	await channels.enter(rider, theirs);

	await rider.goto(`/crew/${theirs.crew}`);
	const leave = rider.getByRole('button', { name: 'Leave the crew' });
	await leave.focus();
	await rider.keyboard.press('Enter');
	await expect(rider.getByRole('dialog')).toBeVisible();
	await rider.keyboard.press('Escape');
	await expect(rider.getByRole('dialog')).toBeHidden();

	await expect(leave).toBeFocused();
});
