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
	if (name) parts.push(name);
	if (riders > 1) parts.push(`${riders} riders`);
	return parts.join(' · ');
}
