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

/**
 * Session times: "Today 18:30", "Tomorrow 18:30", else "Thu 18:30" — with
 * day/month when the date matters. The picker teaches Today and Tomorrow,
 * so the row that follows says them back rather than "Tue 09/09".
 */
export function formatWhen(
	iso: string,
	withDate = false,
	now = Date.now(),
): string {
	const then = new Date(iso);
	const time = then.toLocaleTimeString(undefined, {
		hour: '2-digit',
		minute: '2-digit',
	});
	const daysAway = calendarDaysApart(new Date(now), then);
	if (daysAway === 0) return `Today ${time}`;
	if (daysAway === 1) return `Tomorrow ${time}`;
	return then.toLocaleString(undefined, {
		weekday: 'short',
		...(withDate ? { day: '2-digit', month: '2-digit' } : {}),
		hour: '2-digit',
		minute: '2-digit',
	});
}

/** Whole calendar days from `from` to `to` in local time; negative for the past. */
function calendarDaysApart(from: Date, to: Date): number {
	const a = new Date(from.getFullYear(), from.getMonth(), from.getDate());
	const b = new Date(to.getFullYear(), to.getMonth(), to.getDate());
	return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

/**
 * When someone joined, to the month: "Sept 2026". The rows that say "since"
 * (a crew's people, a room's members, the room settings header) all use it,
 * so they cannot drift apart.
 */
export function formatMonth(iso: string): string {
	return new Date(iso).toLocaleDateString(undefined, {
		month: 'short',
		year: 'numeric',
	});
}

/** A message's wall-clock time, "23:33" — the stamp beside every chat line. */
export function formatTime(ms: number): string {
	return new Date(ms).toLocaleTimeString(undefined, {
		hour: '2-digit',
		minute: '2-digit',
	});
}

/** One decimal, or an en dash while weight is unknown — never `Infinity`. */
export function wkg(watts: number, kg: number | null | undefined): string {
	return kg && kg > 0 ? (watts / kg).toFixed(1) : '–';
}
