/** #3215: a secondary computer field dims to 60 % after this long without change, in ms. */
export const DIM_AFTER_MS = 20_000;

/** When each field's value last changed; a field never seen yet counts as changed now. */
export function fieldDimmer() {
	const seen = new Map<string, { value: string; at: number }>();
	return {
		see(key: string, value: string, now: number) {
			if (seen.get(key)?.value !== value) seen.set(key, { value, at: now });
		},
		dimmed(key: string, now: number): boolean {
			const s = seen.get(key);
			return !!s && now - s.at >= DIM_AFTER_MS;
		},
	};
}
