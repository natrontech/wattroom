// The world's one motion vocabulary: an exponential follow with a half-life,
// the same at 30 fps as at 60 because it is written in seconds, not frames.
// Returns the fraction of the remaining distance to cover this step.
export const damp = (halfLife: number, dt: number): number =>
	1 - Math.pow(2, -dt / halfLife);
