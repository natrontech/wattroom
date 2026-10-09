import type { LiveCrew } from '$lib/crews-live';
import { sessionPath } from '$lib/channel/address';
import { planPath } from '$lib/crew-schedule';
import { formatTime } from '$lib/format';

/** One row of GET /api/schedule: a plan, which crew's it is (#2440), the
 *  voice channel when it names one, and how many are in (#3689). */
export interface Planned {
	id: string;
	workoutName: string;
	minutes: number;
	startsAt: string;
	createdBy: string;
	crewId: string;
	crewName: string;
	channelName?: string;
	goingCount: number;
}

/** One row of Home's This week: a plan, or a session riding now. */
export interface WeekEntry {
	key: string;
	at: number;
	time: string;
	kind: string;
	title: string;
	meta: string;
	count: string | null;
	href: string;
	live: boolean;
	past: boolean;
}

export interface WeekDay {
	key: string;
	label: string;
	entries: WeekEntry[];
}

const DAYS = 7;

function midnight(ms: number, plusDays = 0): number {
	const d = new Date(ms);
	return new Date(
		d.getFullYear(),
		d.getMonth(),
		d.getDate() + plusDays,
	).getTime();
}

function planEntry(plan: Planned, now: number): WeekEntry {
	const at = Date.parse(plan.startsAt);
	const place = plan.channelName
		? `${plan.crewName} · ${plan.channelName}`
		: plan.crewName;
	return {
		key: `plan:${plan.id}`,
		at,
		time: formatTime(at),
		kind: 'Crew session',
		title: plan.workoutName,
		meta: `${place} · ${plan.minutes} min · planned by ${plan.createdBy}`,
		count: plan.goingCount > 0 ? `${plan.goingCount} going` : null,
		href: planPath(plan.crewId, plan.id),
		live: false,
		// Inside the schedule's 30-minute grace (#2635): its time has gone, and
		// nobody started it.
		past: at < now,
	};
}

/** Every session running in one of your crews' voice channels, as a row:
 *  a started plan leaves the schedule, so this is where it stays in view. */
function liveEntries(crews: readonly LiveCrew[], now: number): WeekEntry[] {
	return crews.flatMap((crew) =>
		crew.channels.flatMap((channel) => {
			const session = channel.session;
			if (!session) return [];
			const at = now - session.elapsed * 1000;
			const riders = session.riders.length;
			return [
				{
					key: `live:${session.id}`,
					at,
					time: formatTime(at),
					kind: 'Crew session',
					title: session.workout || 'A session',
					meta: [
						crew.name,
						channel.name,
						session.coachName && `${session.coachName} coaching`,
					]
						.filter(Boolean)
						.join(' · '),
					count: riders > 0 ? `${riders} riding` : null,
					href: sessionPath(crew.id, session.id),
					live: true,
					past: false,
				},
			];
		}),
	);
}

/** "Thursday 1 October", and today's "Thursday 1 October · Today". */
function dayLabel(ms: number, now: number): string {
	const label = new Date(ms).toLocaleDateString(undefined, {
		weekday: 'long',
		day: 'numeric',
		month: 'long',
	});
	return midnight(ms) === midnight(now) ? `${label} · Today` : label;
}

/** Entries under their day headers, in the order they are ridden. */
export function byDay(entries: readonly WeekEntry[], now: number): WeekDay[] {
	const days: WeekDay[] = [];
	for (const entry of [...entries].sort((a, b) => a.at - b.at)) {
		const key = String(midnight(entry.at));
		const last = days.at(-1);
		if (last?.key === key) last.entries.push(entry);
		else days.push({ key, label: dayLabel(entry.at, now), entries: [entry] });
	}
	return days;
}

/**
 * Home's This week (#3689): today and the six days after it, what is riding
 * now first among today's, then every plan by its time. What lies beyond is
 * `later`, and with nothing this week the first of it is `next`.
 */
export function weekList(
	plans: readonly Planned[],
	crews: readonly LiveCrew[],
	now = Date.now(),
): { week: WeekEntry[]; later: WeekEntry[] } {
	const edge = midnight(now, DAYS);
	const entries = plans.map((plan) => planEntry(plan, now));
	return {
		week: [
			...liveEntries(crews, now),
			...entries.filter((entry) => entry.at < edge),
		],
		later: entries.filter((entry) => entry.at >= edge),
	};
}
