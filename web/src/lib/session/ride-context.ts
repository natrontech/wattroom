import { ROAD_NAME } from '$lib/road/profile';

/**
 * The riding surface's opening eyebrow (TARGETS ride-road-world item 6):
 * mode · workout or road · riders. The workout keeps its name on every step
 * of a flow (TARGETS Flows rule 2), and the block's own name below it
 * replaces it in the heading, so this is the line that still names it.
 */
export function rideContext(
	mode: 'Solo' | 'Session',
	name: string,
	riders = 0,
): string {
	const parts: string[] = [mode];
	// A road's generated name is its numbers, and slot 1's road line is their
	// one home (D17): the eyebrow says "Road" and leaves the km to it.
	if (name.startsWith(`${ROAD_NAME} · `)) parts.push(ROAD_NAME);
	else if (name) parts.push(name);
	if (riders > 1) parts.push(`${riders} riders`);
	return parts.join(' · ');
}
