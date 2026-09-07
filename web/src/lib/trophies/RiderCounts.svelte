<script lang="ts">
	// What a rider has done here (#993). The server already counted all of it
	// to judge achievements and then threw the numbers away; this is where the
	// count itself becomes readable and the badge is the annotation.
	//
	// Wording is locked (docs/SPEC.md): the server cannot hear who talks, so
	// presence is measured, and every surface says "in voice" — never
	// "talking", and never a microphone.
	import Check from '@lucide/svelte/icons/check';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import ProgressBar from '$lib/components/ProgressBar.svelte';
	import { formatDuration } from '$lib/format';
	import { ACHIEVEMENTS } from './catalogue';
	import {
		RIDER_COUNTS,
		type TrophyAchievement,
		type TrophyCounts,
	} from './trophies';

	let {
		counts,
		achievements = [],
		mine = true,
	}: {
		counts: TrophyCounts;
		achievements?: TrophyAchievement[];
		mine?: boolean;
	} = $props();

	const byKey = $derived(new Map(achievements.map((a) => [a.key, a])));
	const metaByKey = new Map(ACHIEVEMENTS.map((a) => [a.key, a]));
	const nothingYet = $derived(
		RIDER_COUNTS.every((row) => counts[row.key] === 0),
	);

	// formatDuration takes seconds and says "9 h 40"; the ledger counts blocks
	// of whole minutes.
	const show = (row: (typeof RIDER_COUNTS)[number]) =>
		row.hours
			? formatDuration(counts[row.key] * 60)
			: counts[row.key].toLocaleString();
</script>

<section>
	<h2 class="text-muted text-xs font-semibold tracking-widest uppercase">
		{mine ? 'What you have done here' : 'What they have done here'}
	</h2>

	{#if nothingYet}
		<div class="mt-3">
			<EmptyState>
				{mine
					? 'Nothing counted yet. Time in a lounge, sessions you ride with other people, sprints you win and tracks the room plays to the end all land here.'
					: 'Nothing counted yet — they have not ridden with anyone here so far.'}
			</EmptyState>
		</div>
	{:else}
		<ul class="panel divide-ink/5 mt-3 divide-y">
			{#each RIDER_COUNTS as row (row.key)}
				{@const badge = row.achievement
					? byKey.get(row.achievement)
					: undefined}
				{@const meta = row.achievement
					? metaByKey.get(row.achievement)
					: undefined}
				<li class="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5">
					<span class="text-muted min-w-28 text-xs">{row.label}</span>
					<span class="font-display font-semibold tabular-nums"
						>{show(row)}</span
					>
					<!-- ADR-0027: how far along someone else is on an unearned badge
					     is their business, so a stranger's page shows the count and
					     the badges they hold, and no bars. -->
					{#if badge?.earnedAt && meta}
						<span class="text-neon ml-auto flex items-center gap-1 text-[11px]"
							><Check size={12} />{meta.name}</span
						>
					{:else if mine && badge?.progress && meta}
						<span class="ml-auto flex items-center gap-2">
							<span class="w-24"
								><ProgressBar
									pct={(badge.progress.have / badge.progress.need) * 100}
								/></span
							>
							<span class="text-muted/70 text-[10px] tabular-nums"
								>{meta.name} · {badge.progress.need.toLocaleString()}</span
							>
						</span>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</section>
