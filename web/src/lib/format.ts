/**
 * Display formatting, one home (#230). These were retyped per surface — the
 * w/kg one four times without the divide-by-zero guard.
 */

/** m:ss, minutes unbounded ("90:00"). The workout editor round-trips this
 * shape ("m:ss — a bare number is minutes") — never add an hours segment. */
export function formatClock(seconds: number): string {
	const minutes = Math.floor(seconds / 60);
	return `${minutes}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
}

/** h:mm:ss above an hour, m:ss below — media positions (jukebox seek bar). */
export function formatClockLong(sec: number): string {
	const s = Math.max(0, Math.floor(sec));
	const m = Math.floor(s / 60) % 60;
	const h = Math.floor(s / 3600);
	const two = (n: number) => String(n).padStart(2, '0');
	return h > 0 ? `${h}:${two(m)}:${two(s % 60)}` : `${m}:${two(s % 60)}`;
}

/** Ride-length prose: "48 min" under an hour, "9 h 40" past it. */
export function formatDuration(seconds: number): string {
	const minutes = Math.max(0, Math.round(seconds / 60));
	if (minutes < 60) return `${minutes} min`;
	return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')}`;
}

/** Session times: "Thu 18:30", with day/month when the date matters. */
export function formatWhen(iso: string, withDate = false): string {
	return new Date(iso).toLocaleString(undefined, {
		weekday: 'short',
		...(withDate ? { day: '2-digit', month: '2-digit' } : {}),
		hour: '2-digit',
		minute: '2-digit',
	});
}

/** One decimal, or an en dash while weight is unknown — never `Infinity`. */
export function wkg(watts: number, kg: number | null | undefined): string {
	return kg && kg > 0 ? (watts / kg).toFixed(1) : '–';
}
