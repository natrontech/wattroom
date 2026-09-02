<script lang="ts">
	// MOCK (#450): the trophy case, an achievement catalogue with the funny
	// ones, XP sources, and a room event. Every number here is a PROPOSAL —
	// docs/SPEC.md decides, never this file.
	import ProgressBar from '$lib/components/ProgressBar.svelte';
	import {
		Award,
		Bike,
		CalendarClock,
		Coffee,
		Flame,
		Headphones,
		Lock,
		Mic,
		Moon,
		Music,
		Rocket,
		Skull,
		Sunrise,
		Users,
		Zap,
	} from '@lucide/svelte';

	const medals = { gold: 7, silver: 9, bronze: 7 };
	const achievements = [
		{
			icon: Sunrise,
			name: 'Sunrise Club',
			how: '5 rides that started before 7:00',
			done: true,
			when: 'Aug 30',
		},
		{
			icon: Skull,
			name: 'Sufferfest Survivor',
			how: 'Finish a session with 45+ min above threshold',
			done: true,
			when: 'Aug 21',
		},
		{
			icon: Music,
			name: 'Never Gonna Give You Up',
			how: 'Ride through a whole track someone queued as a joke',
			done: true,
			when: 'Aug 14',
		},
		{
			icon: Headphones,
			name: 'Lounge Lizard',
			how: '10 hours in a lounge, in voice',
			done: true,
			when: 'Aug 9',
		},
		{
			icon: Mic,
			name: 'The Quiet Type',
			how: '10 sessions in voice without once unmuting',
			done: false,
			pct: 60,
		},
		{
			icon: Flame,
			name: 'Hot End',
			how: 'Hold Z6 for 3 minutes in one block',
			done: true,
			when: 'Aug 28',
		},
		{
			icon: Coffee,
			name: 'Espresso Ride',
			how: 'A ride under 25 minutes, all of it above sweet spot',
			done: false,
			pct: 0,
		},
		{
			icon: Moon,
			name: 'Night Shift',
			how: '5 rides that ended after 23:00',
			done: false,
			pct: 40,
		},
		{
			icon: Rocket,
			name: 'DJ',
			how: 'Queue 50 tracks the room did not skip',
			done: false,
			pct: 72,
		},
		{
			icon: Users,
			name: 'Crew Chief',
			how: 'Coach 20 sessions with 3+ riders',
			done: false,
			pct: 35,
		},
		{
			icon: Bike,
			name: '200 rides',
			how: 'Two hundred rides on WattRoom',
			done: true,
			when: 'Aug 12',
		},
		{
			icon: Zap,
			name: 'Sprint Snob',
			how: 'Win 10 sprint moments on w/kg',
			done: false,
			pct: 80,
		},
	];
	const xp = [
		{
			source: 'Riding',
			rule: '1 kJ = 1 XP',
			status: 'shipped',
			note: 'docs/SPEC.md',
		},
		{
			source: 'Execution bonus',
			rule: 'execution% × 50 per ride',
			status: 'shipped',
			note: 'docs/SPEC.md',
		},
		{
			source: 'Weekly streak',
			rule: '25 × streak weeks, capped at 250',
			status: 'shipped',
			note: 'docs/SPEC.md',
		},
		{
			source: 'Being in the lounge',
			rule: '1 XP per 5 min in voice, capped at 24/day',
			status: 'proposal',
			note: 'never out-earns a ride',
		},
		{
			source: 'Talking',
			rule: '5 XP per session where you spoke',
			status: 'proposal',
			note: 'presence, not volume',
		},
		{
			source: 'Achievements',
			rule: '100–500 XP each, once',
			status: 'proposal',
			note: 'the funny ones pay the same as the hard ones',
		},
	];
	const event = {
		name: 'Thursday Sufferfest',
		room: 'Thursday Sufferfest',
		when: 'Thursday 19:30 · weekly',
		workout: 'VO₂ 5×3',
		going: ['Jan', 'David', 'Sven', 'Mike', 'Nina'],
		maybe: 2,
	};
	const board = [
		{ name: 'David', wkg: 4.1, xp: 1240 },
		{ name: 'Jan', wkg: 3.9, xp: 1180 },
		{ name: 'Sven', wkg: 3.4, xp: 990 },
	];
</script>

<main class="page">
	<p class="eyebrow">mock · gamification (#450)</p>
	<h1 class="font-display mt-2 text-3xl font-bold tracking-tight">
		Trophy case
	</h1>
	<p class="text-muted mt-1 max-w-2xl text-sm">
		Levels and medals exist. This adds achievements — riding ones and lounge
		ones — XP for being around, and room events. Every number is a proposal for
		docs/SPEC.md.
	</p>

	<section class="mt-6 grid grid-cols-3 gap-3 sm:max-w-md">
		{#each Object.entries(medals) as [tier, n] (tier)}
			<div class="panel px-4 py-3">
				<p class="eyebrow flex items-center gap-1">
					<Award size={11} />
					{tier}
				</p>
				<p
					class="font-display text-2xl font-bold tabular-nums {tier === 'gold'
						? 'text-z5'
						: ''}"
				>
					{n}
				</p>
			</div>
		{/each}
	</section>

	<section class="mt-8">
		<div class="flex items-baseline gap-3">
			<h2 class="text-muted text-xs font-semibold tracking-widest uppercase">
				Achievements
			</h2>
			<span class="text-muted/70 text-[11px]">6 of 12</span>
		</div>
		<ul class="mt-3 grid gap-2 md:grid-cols-2 2xl:grid-cols-3">
			{#each achievements as a (a.name)}
				<li
					class="panel flex items-start gap-3 px-4 py-3 {a.done
						? ''
						: 'opacity-75'}"
				>
					<span
						class="grid h-10 w-10 shrink-0 place-items-center rounded-full {a.done
							? 'bg-neon/15 text-neon'
							: 'bg-surface text-muted'}"
					>
						{#if a.done}<a.icon size={18} />{:else}<Lock size={16} />{/if}
					</span>
					<span class="min-w-0 flex-1">
						<span class="block text-sm font-medium">{a.name}</span>
						<span class="text-muted block text-[11px]">{a.how}</span>
						{#if a.done}
							<span class="text-muted/70 mt-1 block text-[10px]"
								>earned {a.when}</span
							>
						{:else}
							<span class="mt-1.5 block"><ProgressBar pct={a.pct ?? 0} /></span>
						{/if}
					</span>
				</li>
			{/each}
		</ul>
	</section>

	<div class="mt-8 grid gap-8 xl:grid-cols-2">
		<section>
			<h2 class="text-muted text-xs font-semibold tracking-widest uppercase">
				Where XP comes from
			</h2>
			<div class="table-wrap panel mt-3 overflow-x-auto">
				<table class="w-full text-sm">
					<thead>
						<tr
							class="text-muted text-left text-[10px] tracking-widest uppercase"
						>
							<th class="px-4 py-2">source</th><th class="px-4 py-2">rule</th
							><th class="px-4 py-2">status</th>
						</tr>
					</thead>
					<tbody>
						{#each xp as row (row.source)}
							<tr class="border-ink/5 border-t">
								<td class="px-4 py-2 font-medium">{row.source}</td>
								<td class="px-4 py-2 font-mono text-xs">{row.rule}</td>
								<td class="px-4 py-2">
									<span
										class="rounded-full px-2 py-0.5 text-[10px] tracking-wider uppercase {row.status ===
										'shipped'
											? 'bg-z4/15 text-z4'
											: 'bg-neon/15 text-neon'}">{row.status}</span
									>
									<span class="text-muted ml-2 text-[11px]">{row.note}</span>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</section>

		<section>
			<h2 class="text-muted text-xs font-semibold tracking-widest uppercase">
				A room event
			</h2>
			<div class="panel mt-3 p-5">
				<div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
					<h3 class="font-display text-lg font-bold">{event.name}</h3>
					<span class="text-muted flex items-center gap-1 text-xs"
						><CalendarClock size={12} /> {event.when}</span
					>
				</div>
				<p class="text-muted mt-1 text-sm">
					{event.workout} in {event.room} · every week, same slot, same crew.
				</p>
				<div class="mt-3 flex flex-wrap items-center gap-2">
					<button class="btn btn-primary btn-xs">I'm in</button>
					<span class="text-muted text-xs"
						>{event.going.join(', ')} are in · {event.maybe} maybe</span
					>
				</div>
				<div class="mt-4">
					<p class="eyebrow">event standings · w/kg, then XP</p>
					<ol class="mt-1.5 space-y-1">
						{#each board as row, i (row.name)}
							<li class="flex items-center gap-3 text-sm">
								<span class="font-display text-muted w-5 tabular-nums"
									>{i + 1}</span
								>
								<span class="flex-1">{row.name}</span>
								<span
									class="font-display tabular-nums {i === 0 ? 'text-watt' : ''}"
									>{row.wkg.toFixed(1)}</span
								>
								<span class="text-muted w-16 text-right text-xs tabular-nums"
									>{row.xp} XP</span
								>
							</li>
						{/each}
					</ol>
				</div>
				<p class="text-muted/70 mt-3 text-[10px]">
					An event is a session with an RSVP and a standing. Series (weekly)
					roll a season leaderboard — proposal.
				</p>
			</div>
		</section>
	</div>
</main>
