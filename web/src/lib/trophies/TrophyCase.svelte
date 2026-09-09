<script lang="ts">
	// The trophy case (#1330): your level's receipts — the numbers, the medal
	// shelf and where the XP came from. It was a page of its own; it is the
	// own rider's page now (identity, not settings), beside the counts and
	// the badges that page already drew.
	import ProgressBar from '$lib/components/ProgressBar.svelte';
	import { levelFromXp, levelProgress, xpForLevel } from '$lib/level';
	import TrophyShelf from '$lib/trophies/TrophyShelf.svelte';
	import { XP_SOURCES, type Trophies } from '$lib/trophies/trophies';
	import Zap from '@lucide/svelte/icons/zap';

	let { trophies }: { trophies: Trophies } = $props();

	const level = $derived(levelFromXp(trophies.xp.total));
	const toNext = $derived(
		Math.max(0, xpForLevel(level + 1) - trophies.xp.total),
	);
	const kwh = $derived(trophies.energyKj / 3600);
</script>

<!-- You, in numbers: the level and what fed it. Energy is the honest one —
     watts over time, no formula in between. -->
<section class="grid grid-cols-2 gap-3 sm:grid-cols-4">
	<div class="panel px-4 py-3">
		<p class="eyebrow">level</p>
		<p class="font-display text-2xl font-bold tabular-nums">{level}</p>
		<div class="mt-1.5">
			<ProgressBar pct={levelProgress(trophies.xp.total) * 100} />
		</div>
		<p class="text-muted mt-1 text-[11px] tabular-nums">
			{toNext.toLocaleString()} XP to {level + 1}
		</p>
	</div>
	<div class="panel px-4 py-3">
		<p class="eyebrow">xp, lifetime</p>
		<p class="font-display text-2xl font-bold tabular-nums">
			{trophies.xp.total.toLocaleString()}
		</p>
		<p class="text-muted text-[11px] tabular-nums">
			{Math.round((trophies.xp.rides / Math.max(1, trophies.xp.total)) * 100)}%
			from riding
		</p>
	</div>
	<div class="panel px-4 py-3">
		<p class="eyebrow flex items-center gap-1">
			<Zap size={11} /> energy generated
		</p>
		<p class="font-display text-2xl font-bold tabular-nums">
			{trophies.energyKj.toLocaleString()}<span class="text-muted ml-1 text-sm"
				>kJ</span
			>
		</p>
		<p class="text-muted text-[11px] tabular-nums">
			{kwh >= 10 ? Math.round(kwh) : kwh.toFixed(1)} kWh, into the trainer
		</p>
	</div>
	<div class="panel px-4 py-3">
		<p class="eyebrow">achievements</p>
		<p class="font-display text-2xl font-bold tabular-nums">
			{trophies.achievements.filter((a) => a.earnedAt).length}<span
				class="text-muted ml-1 text-sm">of {trophies.achievements.length}</span
			>
		</p>
		<p class="text-muted text-[11px] tabular-nums">
			{trophies.xp.achievements.toLocaleString()} XP from them
		</p>
	</div>
</section>

<div class="mt-8">
	<TrophyShelf {trophies} />
</div>

<section class="mt-8">
	<h2 class="text-muted text-xs font-semibold tracking-widest uppercase">
		Where XP comes from
	</h2>
	<p class="text-muted mt-0.5 max-w-2xl text-xs">
		Riding pays best by a wide margin; the rest rewards being around. Being in
		voice is what counts — the server cannot hear who talks.
	</p>
	<div class="panel mt-3 overflow-x-auto">
		<table class="w-full text-sm">
			<thead>
				<tr class="text-muted text-left text-[10px] tracking-widest uppercase">
					<th class="px-4 py-2">source</th>
					<th class="px-4 py-2">rule</th>
					<th class="px-4 py-2 text-right">earned</th>
				</tr>
			</thead>
			<tbody>
				{#each XP_SOURCES as row (row.key)}
					<tr class="border-ink/5 border-t">
						<td class="px-4 py-2 font-medium">{row.source}</td>
						<td class="text-muted px-4 py-2 text-xs">{row.rule}</td>
						<td
							class="font-display px-4 py-2 text-right font-semibold tabular-nums"
							>{trophies.xp[row.key].toLocaleString()} XP</td
						>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
</section>
