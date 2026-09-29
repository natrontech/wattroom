import type { LiveRider } from '$lib/channel/types';

/**
 * Who the Training place's crew strip draws, you first when you are in it.
 *
 * You are in it whenever your camera is on (#2655): the strip was the only
 * place a camera was drawn on this surface, and it left you out, so a rider
 * had no way to see that their camera was live and framed. Without a
 * camera your tile only repeats the instrument, so it stays out — except
 * on the phone while you pedal (`whileRiding`) and the instrument follows
 * someone else (`followedId`), when your watts are otherwise nowhere. While
 * it follows you, your tile would draw them a second time (#2882 L6-13).
 */
export function crewOf(
	riders: LiveRider[],
	whileRiding: boolean,
	followedId: string | null = null,
): LiveRider[] {
	const others = riders.filter((rider) => !rider.you);
	const you = riders.find((rider) => rider.you);
	if (!you) return others;
	return you.cameraOn || (whileRiding && you.watts > 0 && followedId !== you.id)
		? [you, ...others]
		: others;
}
