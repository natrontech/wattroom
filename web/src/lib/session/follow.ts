import type { LiveRider } from '$lib/channel/types';

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
 * It reuses the voice channel's existing focus (the Lounge's tile spotlight)
 * rather than inventing a second "followed rider": one concept, one home.
 */
export function followedRider(
	riders: LiveRider[],
	focusId: string | null,
): LiveRider | null {
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

/**
 * Who the Training place's crew strip draws, you first when you are in it.
 *
 * You are in it whenever your camera is on (#2655): the strip was the only
 * place a camera was drawn on this surface, and it left you out, so a rider
 * had no way to see that their camera was live and framed. Without a
 * camera your tile only repeats the instrument, so it stays out — except
 * on the phone while you pedal (`whileRiding`), where the instrument may be
 * following someone else and your watts are otherwise nowhere.
 */
export function crewOf(riders: LiveRider[], whileRiding: boolean): LiveRider[] {
	const others = riders.filter((rider) => !rider.you);
	const you = riders.find((rider) => rider.you);
	if (!you) return others;
	return you.cameraOn || (whileRiding && you.watts > 0)
		? [you, ...others]
		: others;
}
