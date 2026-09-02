<script lang="ts">
	// The shelf (#467): medal counts and the achievement catalogue with how
	// far along each one is. Pure — hand it a Trophies payload and it draws;
	// /trophies and a profile page both use it.
	import { Award, Lock } from '@lucide/svelte';
	import ProgressBar from '$lib/components/ProgressBar.svelte';
	import { MEDAL_KINDS, MEDAL_META } from '$lib/medals';
	import { ACHIEVEMENTS } from './catalogue';
	import { MEDAL_COUNT_KEY, type Trophies } from './trophies';

	let { trophies }: { trophies: Trophies } = $props();

	const byKey = $derived(new Map(trophies.achievements.map((a) => [a.key, a])));
	const earned = $derived(
		trophies.achievements.filter((a) => a.earnedAt).length,
	);
	const medalTotal = $derived(
		MEDAL_KINDS.reduce(
			(n, kind) => n + trophies.medals[MEDAL_COUNT_KEY[kind]],
			0,
		),
	);
</script>

<section>
	<div class="flex items-baseline gap-3">
		<h2 class="text-muted text-xs font-semibold tracking-widest uppercase">
			Medals
		</h2>
		<span class="text-muted/70 text-[11px]">
			{medalTotal === 0
				? 'awarded after group sessions of three or more'
				: `${medalTotal} from group sessions`}
		</span>
	</div>
	<ul class="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
		{#each MEDAL_KINDS as kind (kind)}
			{@const n = trophies.medals[MEDAL_COUNT_KEY[kind]]}
			<li class="panel px-4 py-3 {n === 0 ? 'opacity-75' : ''}">
				<p class="eyebrow flex items-center gap-1">
					<Award size={11} />
					{MEDAL_META[kind].name}
				</p>
				<p class="font-display text-2xl font-bold tabular-nums">{n}</p>
				<p class="text-muted text-[11px]">{MEDAL_META[kind].criterion}</p>
			</li>
		{/each}
	</ul>
</section>

<section class="mt-8">
	<div class="flex items-baseline gap-3">
		<h2 class="text-muted text-xs font-semibold tracking-widest uppercase">
			Achievements
		</h2>
		<span class="text-muted/70 text-[11px]"
			>{earned} of {ACHIEVEMENTS.length}</span
		>
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
					{:else if state?.progress}
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
					{:else}
						<span class="text-muted/70 mt-1 block text-[10px]"
							>one ride does it</span
						>
					{/if}
				</span>
			</li>
		{/each}
	</ul>
</section>
