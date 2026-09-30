/**
 * Your dot's halo on the road (#3059, #3645): the watt colour fading out,
 * painted once as a background, never a filter (#2998). The Skyline's dot and
 * the climb card's are the only glows on a road, and they are the same one.
 */
export const HALO =
	'radial-gradient(circle, var(--color-watt) 0 28%, color-mix(in oklab, var(--color-watt) 35%, transparent) 42%, transparent 70%)';
