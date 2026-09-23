import { expect, test, voicePath } from './crew';
import { signInAs } from './signin';

type Plan = { channelId?: string };
const plansOf = (crew: string) =>
	fetch(`/api/crews/${crew}/schedule`)
		.then((res) => res.json())
		.then((body: { sessions: Plan[] }) => body.sessions);

/**
 * A voice channel plans into itself (#2572). Its picker's "Plan it for later"
 * was refused every time: the channel handed it a planner that only toasted
 * that plans live on the crew's schedule. Walked to the plan it makes, because
 * the refusal rendered, closed nothing and logged nothing a test would see.
 */
test('a voice channel plans a session into itself', async ({
	page,
	channels,
	schedules,
}) => {
	await signInAs(page, 'Channel Planner', '/home');
	const opened = await channels.open(
		page,
		`Channel Plan ${Date.now() % 100000}`,
	);
	await schedules.own(page, opened.crew);

	await page.goto(voicePath(opened));
	const plan = page.getByRole('button', { name: 'Plan for later' });
	await expect(plan).toBeVisible();
	// The call, not the crew's dashboard (#2571): the invite is the crew
	// Home's, and the owner opening this channel holds its code.
	await expect(page.getByRole('button', { name: /invite link/i })).toHaveCount(
		0,
	);

	await plan.click();
	const picker = page.getByRole('dialog');
	await picker.getByRole('listitem').getByRole('button').first().click();
	await picker.getByRole('button', { name: 'Plan it', exact: true }).click();
	await expect(picker).toHaveCount(0);

	expect(await page.evaluate(plansOf, opened.crew)).toMatchObject([
		{ channelId: opened.voice },
	]);
});

/**
 * The crew's Home plans through its Schedule, with the picker already open
 * and where it runs chosen inside it (#2572) — it used to be a line on the
 * page behind the picker, set before opening it.
 */
test('the crew Home opens the planner, and the plan names its channel', async ({
	page,
	channels,
	schedules,
}) => {
	await signInAs(page, 'Home Planner', '/home');
	const opened = await channels.open(page, `Home Plan ${Date.now() % 100000}`);
	await schedules.own(page, opened.crew);

	await page.goto(`/crew/${opened.crew}`);
	await page.getByRole('link', { name: 'Plan a session' }).click();
	await expect(page).toHaveURL(/\/schedule\?plan$/);

	// A new crew has a voice channel of its own besides the one opened here,
	// and the picker starts on the first: choosing the other is the proof
	// that where is asked here and not on the page behind.
	const picker = page.getByRole('dialog');
	await picker.getByRole('listitem').getByRole('button').first().click();
	await picker.getByRole('combobox', { name: /^voice channel/ }).click();
	await picker.getByRole('option', { name: opened.name }).click();
	await picker.getByRole('button', { name: 'Plan it', exact: true }).click();
	await expect(picker).toHaveCount(0);

	expect(await page.evaluate(plansOf, opened.crew)).toMatchObject([
		{ channelId: opened.voice },
	]);
});
