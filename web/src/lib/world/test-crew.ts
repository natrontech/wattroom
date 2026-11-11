import { MOST_ABREAST } from '#lib/world/lanes.ts';
import { bunchLooks, seededLoadout } from '#lib/world/loadout.ts';
import { simRider, type SimRider } from '#lib/world/sim.ts';

/**
 * The dev gallery's crew (#3663): you on your own FTP and three stand-ins a
 * few wheels apart, so the camera sees riders around you. Only /dev/perf's
 * world case rides with them — a ride's world holds the riders who are there.
 */

// A stand-in rides like a person: harder on climbs, soft on descents, a little noise.
export function botWatts(r: SimRider, grade: number, t: number): number {
	const push =
		grade > 2 ? 1.05 + Math.min(0.15, grade / 60) : grade < -3 ? 0.35 : 0.82;
	const wobble =
		1 + 0.06 * Math.sin(t / 7 + r.mass) + 0.03 * Math.sin(t / 1.7 + r.ftp);
	return r.ftp * push * wobble;
}

/**
 * `kit` dresses you in that jersey pattern on a white ground (#3156), the
 * ground Gipfelpunkte must never dot; absent, you wear your seeded look.
 * `alone` is a design capture's frame (G9): the figure with no stand-ins.
 */
/** id, name, kg, FTP and where they start, metres from you: some ahead, one coming past. */
const MORE: [string, string, number, number, number][] = [
	['lea', 'Lea', 58, 240, 26],
	['nico', 'Nico', 78, 320, -14],
	['ana', 'Ana', 64, 230, 48],
	['ben', 'Ben', 85, 260, 70],
	['ida', 'Ida', 55, 250, 12],
];

export function devCrew(
	watts: number,
	ftp: number,
	kit?: string | null,
	alone = false,
	/** More riders round you, at the gaps a real group ride spreads to: a design capture's bunch. */
	more = 0,
): SimRider[] {
	const bot = (
		id: string,
		name: string,
		mass: number,
		ftp: number,
		i: number,
	) => ({
		...simRider({ id, name, mass, ftp, you: false, watts: 0, d: i * 7 }),
		ride: botWatts,
	});
	const you = simRider({
		id: 'you',
		name: 'You',
		mass: 80,
		ftp,
		you: true,
		watts,
		d: 0,
	});
	if (kit) {
		const seeded = seededLoadout('you');
		you.look = {
			...seeded,
			jersey: `jp.${kit}`,
			colours: { ...seeded.colours, jerseyA: 'snow', jerseyB: 'rust' },
		};
	}
	const crew = alone
		? [you]
		: [
				you,
				bot('sven', 'Sven', 74, 270, 1),
				bot('mia', 'Mia', 61, 215, 2),
				bot('tom', 'Tom', 92, 300, 3),
				...MORE.slice(0, more).map(([id, name, mass, ftp, d]) => ({
					...simRider({ id, name, mass, ftp, you: false, watts: 0, d }),
					ride: botWatts,
				})),
			];
	// Each in their own kit, as a bunch dresses its riders (#3791).
	const looks = bunchLooks(crew, MOST_ABREAST);
	for (const r of crew) r.look = looks.get(r.id);
	return crew;
}
