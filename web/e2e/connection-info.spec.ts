import { expect, test } from './room';

/**
 * A rider's connection, and whose address it is (#2131).
 *
 * The privacy half is what earns a browser test rather than a unit one. The
 * server test (hub/connection_test.go) proves an address never rides the tick;
 * this proves the other end of the same promise — that the panel a rider opens
 * on SOMEBODY ELSE has no address row in it at all, which is a property of
 * what was rendered and not of what crossed the wire.
 *
 * Two real riders, because "someone else's panel" cannot be faked with one.
 *
 * Voice is deliberately not joined here: the quality tier is the only value
 * that needs it, LiveKit is shared between everyone working this repo
 * (AGENTS.md), and its absent state — the one this leaves asserted — is the
 * capability gate that has to be right anyway.
 */

const B = 'Ruben';

/** The people column is an xl surface; below it, it is a drawer instead. */
const WIDE = { width: 1440, height: 900 };

/** Slack over a live wait: a 1 Hz tick, and a ping measured every 5 s. */
const SETTLE_MS = 20_000;

test('a rider sees everyone in the room, and their own address alone', async ({
	riders,
	rooms,
}) => {
	test.skip(
		!!process.env.PLAYWRIGHT_BASE_URL,
		'the ?as= dev provider only exists on a dev server',
	);

	const a = await riders();
	await a.setViewportSize(WIDE);
	const name = `Connection ${Date.now() % 100000}`;
	const room = await rooms.open(a, name);

	const b = await riders(B);
	await rooms.enter(b, room);

	// The menu's entries are built when it OPENS, off the roster the last tick
	// carried — so a right-click before the first tick offers no Connection at
	// all. The lounge's tiles come from that same roster: once both riders have
	// one, the tick has landed. (Not a race the app loses — the entry appears
	// within a second and stays — but one a test can.)
	const tiles = a.getByTestId('rider-tile');
	await expect(tiles, `${B} never reached A's roster`).toHaveCount(2, {
		timeout: SETTLE_MS,
	});

	// --- somebody else's connection ----------------------------------------
	await tiles.filter({ hasText: B }).first().click({ button: 'right' });
	await a.getByRole('menuitem', { name: 'Connection' }).click();

	const panel = a.getByRole('dialog');
	await expect(panel).toBeVisible();
	// The ping is the server's measurement of THEIR socket, so it arrives on
	// the room's own schedule rather than instantly — poll for a number.
	await expect
		.poll(
			async () =>
				(await panel.getByTestId('connection-ping').innerText()).trim(),
			{
				message: `${B}'s ping never arrived on the roster`,
				timeout: SETTLE_MS,
			},
		)
		.toMatch(/^\d+\s*ms$/);
	// Both riders are on a desktop browser here, so the word is knowable.
	await expect(panel.getByTestId('connection-device')).toHaveText('PC');
	// Nobody is in voice, so there is no link for the SFU to judge — and the
	// panel says which, rather than showing a dash it does not explain.
	await expect(panel.getByTestId('connection-quality')).toHaveText('—');
	await expect(panel).toContainText('Quality needs voice.');
	// The row that must not be there. Not "empty" — absent.
	await expect(
		panel.getByTestId('connection-ip'),
		"another rider's panel must not have an address row at all",
	).toHaveCount(0);
	await a.keyboard.press('Escape');
	await expect(panel).toHaveCount(0);

	// --- your own ----------------------------------------------------------
	await tiles.filter({ hasText: 'Dev Rider' }).first().click({
		button: 'right',
	});
	await a.getByRole('menuitem', { name: 'Connection' }).click();
	const own = a.getByRole('dialog');
	await expect(own).toBeVisible();
	await expect(
		own.getByTestId('connection-ip'),
		'your own panel is the one place an address belongs',
	).toHaveCount(1);
	// A loopback dev server sees 127.0.0.1 or ::1; either is an address, and
	// asserting the exact one would be asserting the harness.
	await expect(own.getByTestId('connection-ip')).not.toHaveText('—');
});
