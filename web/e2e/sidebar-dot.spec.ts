import { expect, test } from './crew';

/**
 * The dot on a face in the sidebar (#1742).
 *
 * `status.ts` decides the word and `Avatar.svelte` draws the mark, and both
 * have unit tests — but nothing put the two together on a screen, so the last
 * bullet of the presence audit stayed open after the away set (#1750) and the
 * reconnect tests (#1776) landed. The gap is real and not theoretical: the
 * sidebar's DM rows are the one surface that reads BOTH feeds, the live read
 * for riders it can see in a voice channel (the rail's rooms, before
 * ADR-0058) and the friends list for everyone else, and a rider who is away
 * in one used to read as plain `online` here while their own tile there said
 * away.
 *
 * Four rows, one per state the badge can be in, because the states are only
 * worth anything against each other — a badge that says "online" about
 * everybody passes any test that looks at one row.
 */
const A = 'Sidebar Dot Host';

/** Who is in the fixture, and what the sidebar should say about each. */
const peers = [
	{ id: 'dot-riding', name: 'Ruben Rides', badge: 'riding now' },
	{ id: 'dot-away', name: 'Kim Away', badge: 'Away' },
	{ id: 'dot-online', name: 'Mila Lounging', badge: 'online' },
	{ id: 'dot-offline', name: 'Theo Gone', badge: 'offline' },
];

test('the sidebar draws each rider’s state on their own face', async ({
	riders,
}) => {
	test.skip(
		!!process.env.PLAYWRIGHT_BASE_URL,
		'the ?as= dev provider only exists on a dev server',
	);
	// Every row reads `online`: the dot asks statusOf(presence.rooms, …), and
	// presence.rooms has been [] since the rooms left the server (#2446) —
	// nothing reads the voice channels' occupants for it.
	test.fixme(
		true,
		"#2517: the DM row's dot never reads the crews' live read, only the always-empty room list",
	);

	const a = await riders(A);
	// Desk width: below md the sidebar is a drawer and these rows are behind
	// the hamburger.
	await a.setViewportSize({ width: 1440, height: 900 });

	// Four conversations, so four faces are on screen. `mine` is true on all of
	// them: an inbound line would toast, and the toast is #1743's test, not
	// this one.
	await a.route('**/api/dms', (route) =>
		route.fulfill({
			json: {
				conversations: peers.map((peer, i) => ({
					peerId: peer.id,
					peerName: peer.name,
					text: 'see you at seven',
					mine: true,
					at: 1000 - i,
				})),
			},
		}),
	);
	// The crews' live read puts three of them in one voice channel — riding,
	// away, and neither. Served as a fixture for the same reason
	// presence-states.spec.ts does it: the states differ only in what the hub
	// answered, and driving three real riders onto three real trainers would
	// prove nothing this does not.
	await a.route('**/api/crews/live', (route) =>
		route.fulfill({
			json: {
				crews: [
					{
						id: 'crew-dot',
						name: 'Dot Crew',
						role: 'member',
						channels: [
							{
								id: 'voice-dot',
								kind: 'voice',
								name: 'Dot Voice',
								occupants: [
									{ id: 'dot-riding', name: 'Ruben Rides', riding: true },
									{
										id: 'dot-away',
										name: 'Kim Away',
										riding: true,
										away: true,
									},
									{ id: 'dot-online', name: 'Mila Lounging' },
								],
							},
						],
					},
				],
			},
		}),
	);
	// And the friends list answers for the fourth, whom no channel the viewer
	// can see has anything to say about.
	await a.route('**/api/friends', (route) =>
		route.fulfill({
			json: {
				code: 'SDBRDT',
				declines: [],
				friends: peers.map((peer) => ({
					id: peer.id,
					name: peer.name,
					status: 'accepted',
					at: 1,
					online: peer.id !== 'dot-offline',
				})),
			},
		}),
	);
	await a.goto('/home');

	// The sidebar's own rows: Home draws its conversations too, from the same
	// heads, so an unscoped href matches twice.
	const sidebar = a.getByLabel('rooms and places');
	const row = (id: string) => sidebar.locator(`a[href="/messages/dm/${id}"]`);
	await expect(row('dot-riding')).toBeVisible({ timeout: 20_000 });

	for (const peer of peers) {
		// The badge is a `role="img"` inside the row, so it is named rather than
		// read — which is also the only thing a screen reader gets from a dot.
		await expect(
			row(peer.id).getByRole('img', { name: peer.badge }),
			`${peer.name}'s row should say ${peer.badge}`,
		).toBeVisible({ timeout: 20_000 });
		// And says nothing else: three of these four states are one wrong
		// branch apart in `statusOf`, so asserting only the right one lets a
		// badge that says every word at once through.
		for (const other of peers) {
			if (other.badge === peer.badge) continue;
			await expect(
				row(peer.id).getByRole('img', { name: other.badge }),
			).toHaveCount(0);
		}
	}

	// The disagreement the away set was added to end (#1742): the live read
	// has this rider BOTH away and riding, exactly as the hub sends it when
	// somebody steps off mid-interval, and away is what a face says. Before
	// away reached this feed the sidebar had no away to return at all and
	// drew the riding mark here while the rider's own tile in the channel drew
	// the cup.
	await expect(
		row('dot-away').getByRole('img', { name: 'riding now' }),
	).toHaveCount(0);
});
