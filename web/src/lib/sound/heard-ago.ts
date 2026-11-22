/** How long ago a cue sounded, as the caption's list says it. */
export function ago(ms: number): string {
	const s = Math.max(0, Math.round(ms / 1000));
	if (s < 5) return 'now';
	if (s < 60) return `${s} s ago`;
	const min = Math.floor(s / 60);
	return min < 60 ? `${min} min ago` : `${Math.floor(min / 60)} h ago`;
}
