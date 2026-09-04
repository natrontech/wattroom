<script lang="ts">
	// The achievement half of the shelf, on its own so a rider's page can show
	// badges without the medals beside them (#701): the trophy case counts
	// medals for a lifetime, while ADR-0024 lets a rider's page show only the
	// ones earned in rooms you share. Two different rules, so two components.
	//
	// `mine` is the ADR-0027 line. Your own case shows how far along you are
	// and how many of the catalogue you hold; someone else's shows the badges
	// they have earned and nothing more — progress is their current week, and
	// a completion score is a ladder wearing a smaller hat.
	import { Lock } from '@lucide/svelte';
	import ProgressBar from '$lib/components/ProgressBar.svelte';
	import { ACHIEVEMENTS } from './catalogue';
	import type { TrophyAchievement } from './trophies';

	let {
		achievements,
		mine = true,
	}: { achievements: TrophyAchievement[]; mine?: boolean } = $props();

	const byKey = $derived(new Map(achievements.map((a) => [a.key, a])));
	const earned = $derived(achievements.filter((a) => a.earnedAt).length);
</script>

<section class="mt-8">
	<div class="flex items-baseline gap-3">
		<h2 class="text-muted text-xs font-semibold tracking-widest uppercase">
			Achievements
		</h2>
		{#if mine}
			<span class="text-muted/70 text-[11px]"
				>{earned} of {ACHIEVEMENTS.length}</span
			>
		{:else if earned > 0}
			<span class="text-muted/70 text-[11px]"
				>{earned === 1 ? '1 earned' : `${earned} earned`}</span
			>
		{/if}
	</div>
	<ul class="mt-3 grid gap-2 md:grid-cols-2 2xl:grid-cols-3">
		{#each ACHIEVEMENTS as meta (meta.key)}
			{@const state = byKey.get(meta.key)}
			{@const done = Boolean(state?.earnedAt)}
			<li
				class="panel flex items-start gap-3 px-4 py-3 {done
					? ''
					: 'opacity-75'}"
			>
				<span
					class="grid h-10 w-10 shrink-0 place-items-center rounded-full {done
						? 'bg-neon/15 text-neon'
						: 'bg-surface text-muted'}"
				>
					{#if done}<meta.icon size={18} />{:else}<Lock size={16} />{/if}
				</span>
				<span class="min-w-0 flex-1">
					<span class="flex items-baseline justify-between gap-2">
						<span class="text-sm font-medium">{meta.name}</span>
						<span class="text-muted/70 text-[10px] tabular-nums"
							>{meta.xp} XP</span
						>
					</span>
					<span class="text-muted block text-[11px]">{meta.how}</span>
					{#if done && state?.earnedAt}
						<span class="text-muted/70 mt-1 block text-[10px]">
							earned {new Date(state.earnedAt).toLocaleDateString(undefined, {
								month: 'short',
								day: 'numeric',
							})}
						</span>
					{:else if mine && state?.progress}
						<span class="mt-1.5 block">
							<ProgressBar
								pct={(state.progress.have / state.progress.need) * 100}
								title="{state.progress.have} of {state.progress.need}{meta.unit
									? ' ' + meta.unit
									: ''}"
							/>
						</span>
						<span class="text-muted/70 mt-1 block text-[10px] tabular-nums">
							{state.progress.have.toLocaleString()} / {state.progress.need.toLocaleString()}{meta.unit
								? ` ${meta.unit}`
								: ''}
						</span>
					{:else if mine}
						<span class="text-muted/70 mt-1 block text-[10px]"
							>one ride does it</span
						>
					{/if}
				</span>
			</li>
		{/each}
	</ul>
</section>
