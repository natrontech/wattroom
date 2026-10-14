import { describe, expect, it } from 'vitest';
import type { LiveCrew } from '$lib/crews-live';
import { byDay, weekList, type Planned } from './week-list';

// Thursday 1 October 2026, 18:00 local.
const now = new Date(2026, 9, 1, 18, 0).getTime();
const at = (day: number, hour: number, minute = 0) =>
	new Date(2026, 9, day, hour, minute).toISOString();

const plan = (id: string, startsAt: string, goingCount = 0): Planned => ({
	id,
	workoutName: `Plan ${id}`,
	minutes: 60,
	startsAt,
	createdBy: 'Aare',
	crewId: 'c1',
	crewName: 'Tuesday Bunch',
	channelName: 'Pain Cave',
	goingCount,
});

const riding: LiveCrew = {
	id: 'c1',
	name: 'Tuesday Bunch',
	role: 'member',
	channels: [
		{
			id: 'v1',
			kind: 'voice',
			name: 'Pain Cave',
			session: {
				id: 's1',
				channel: 'v1',
				workout: 'Sweet spot',
				phase: 'running',
				elapsed: 600,
				coach: 'u1',
				coachName: 'Kim',
				riders: ['Kim', 'Tom'],
				riderIds: ['u1', 'u2'],
			},
		},
		{ id: 't1', kind: 'text', name: 'general' },
	],
};

describe('weekList', () => {
	it('keeps today and the six days after it, the rest for later', () => {
		const { week, later } = weekList(
			[plan('a', at(1, 19)), plan('b', at(7, 23, 59)), plan('c', at(8, 0, 0))],
			[],
			now,
		);
		expect(week.map((e) => e.key)).toEqual(['plan:a', 'plan:b']);
		expect(later.map((e) => e.key)).toEqual(['plan:c']);
	});

	it('dims a plan whose time has gone and counts who is in', () => {
		const { week } = weekList(
			[plan('gone', at(1, 17, 45)), plan('on', at(1, 19), 5)],
			[],
			now,
		);
		expect(week.map((e) => [e.past, e.count])).toEqual([
			[true, null],
			[false, '5 going'],
		]);
		expect(week[1]).toMatchObject({
			kind: 'Crew session',
			title: 'Plan on',
			meta: 'Tuesday Bunch · Pain Cave · 60 min · planned by Aare',
			href: '/crew/c1/schedule#plan-on',
		});
	});

	it('rows a session riding now from when it started, to its own page', () => {
		const { week } = weekList([], [riding], now);
		expect(week).toHaveLength(1);
		expect(week[0]).toMatchObject({
			live: true,
			past: false,
			at: now - 600_000,
			title: 'Sweet spot',
			meta: 'Tuesday Bunch · Pain Cave · Kim coaching',
			count: '2 riding',
			href: '/crew/c1/s/s1',
		});
	});
});

describe('byDay', () => {
	it('heads each day once, in ride order, and names today', () => {
		const { week } = weekList(
			[plan('fri', at(2, 12, 10)), plan('thu', at(1, 19))],
			[riding],
			now,
		);
		const days = byDay(week, now);
		expect(days.map((d) => d.entries.map((e) => e.key))).toEqual([
			['live:s1', 'plan:thu'],
			['plan:fri'],
		]);
		expect(days[0].label).toMatch(/ · Today$/);
		expect(days[1].label).not.toMatch(/Today/);
	});
});

describe('the time column', () => {
	it('keeps the day period off the time, where the locale has one', () => {
		const { week } = weekList([plan('a', at(1, 19, 5))], [], now);
		expect(week[0].time).toMatch(/^\d{1,2}[:.]05$/);
		expect(week[0].period ?? '').not.toMatch(/\d/);
	});
});
