import type { RoomRider } from '$lib/room/view';

/**
 * Whose instrument the narrow Training surface shows (#412).
 *
 * A phone has no trainer, so "your numbers" is a needle pinned at 0 W — the
 * one thing a spectator does not want the whole screen for. It follows a
 * rider instead: the one you tapped, else you while you are actually turning
 * the pedals, else whoever is working hardest right now.
 *
 * Hardest is %FTP, the same fair ordering every contest in docs/SPEC.md uses —
 * a 90 kg rider does not lead the strip by existing.
 *
 * It reuses the room's existing focus (the Lounge's tile spotlight) rather
 * than inventing a second "followed rider": one concept, one home.
 */
export function followedRider(
	riders: RoomRider[],
	focusId: string | null,
): RoomRider | null {
	const tapped = riders.find((rider) => rider.id === focusId);
	if (tapped) return tapped;
	const you = riders.find((rider) => rider.you && rider.watts > 0);
	if (you) return you;
	const hardest = riders
		.filter((rider) => rider.watts > 0)
		.sort(
			(a, b) => b.watts / Math.max(1, b.ftp) - a.watts / Math.max(1, a.ftp),
		);
	return hardest[0] ?? riders[0] ?? null;
}
