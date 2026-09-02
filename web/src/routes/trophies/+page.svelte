<script lang="ts">
	// The trophy case (#467): the level's receipts. Where the XP came from,
	// the energy behind it, the medals, the shelf. Every number is the
	// server's; docs/SPEC.md decides the rules and this page repeats them.
	import { Zap } from '@lucide/svelte';
	import Banner from '$lib/components/Banner.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import ProgressBar from '$lib/components/ProgressBar.svelte';
	import Skeleton from '$lib/components/Skeleton.svelte';
	import { levelFromXp, levelProgress, xpForLevel } from '$lib/level';
	import TrophyShelf from '$lib/trophies/TrophyShelf.svelte';
	import {
		fetchTrophies,
		XP_SOURCES,
		type Trophies,
	} from '$lib/trophies/trophies';

	let trophies = $state<Trophies | null>(null);
	let error = $state<string | null>(null);

	async function load() {
		error = null;
		const res = await fetchTrophies();
		if (res.ok) trophies = res.data;
		else error = res.error.message;
	}
	void load();

	const level = $derived(levelFromXp(trophies?.xp.total ?? 0));
	const toNext = $derived(
		Math.max(0, xpForLevel(level + 1) - (trophies?.xp.total ?? 0)),
	);
	// 3600 kJ is one kilowatt-hour — physics, not a product number.
	const kwh = $derived((trophies?.energyKj ?? 0) / 3600);
	const nothingYet = $derived(
		trophies !== null && trophies.xp.total === 0 && trophies.energyKj === 0,
	);
</script>

<main class="page">
	<h1 class="font-display text-2xl leading-tight font-bold">Trophy case</h1>
	<p class="text-muted text-xs">
		Your level's receipts: what you rode, who you rode with, and what it earned.
	</p>

	{#if error}
		<div class="mt-8">
			<Banner tone="error">
				{error}
				{#snippet action()}
					<button
						onclick={() => void load()}
						class="text-muted hover:text-ink text-xs underline">Retry</button
					>
				{/snippet}
			</Banner>
		</div>
	{:else if trophies === null}
		<div class="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
			{#each { length: 4 } as _, i (i)}
				<div class="panel px-4 py-3">
					<Skeleton class="h-3 w-12" />
					<Skeleton class="mt-2 h-7 w-16" />
				</div>
			{/each}
		</div>
		<div class="mt-8 grid gap-2 md:grid-cols-2 2xl:grid-cols-3">
			{#each { length: 6 } as _, i (i)}
				<div class="panel px-4 py-3">
					<Skeleton class="h-4 w-32" />
					<Skeleton class="mt-2 h-3 w-48" />
				</div>
			{/each}
		</div>
	{:else}
		{#if nothingYet}
			<div class="mt-6">
				<EmptyState>
					The case fills as you ride and as you hang out: every kJ is an XP,
					every five minutes in a lounge's voice channel is one more.
					{#snippet cta()}
						<a href="/workouts" class="btn btn-primary btn-xs">Ride a workout</a
						>
					{/snippet}
				</EmptyState>
			</div>
		{/if}

		<!-- You, in numbers: the level and what fed it. Energy is the honest
		     one — watts over time, no formula in between. -->
		<section class="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
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
					{Math.round(
						(trophies.xp.rides / Math.max(1, trophies.xp.total)) * 100,
					)}% from riding
				</p>
			</div>
			<div class="panel px-4 py-3">
				<p class="eyebrow flex items-center gap-1">
					<Zap size={11} /> energy generated
				</p>
				<p class="font-display text-2xl font-bold tabular-nums">
					{trophies.energyKj.toLocaleString()}<span
						class="text-muted ml-1 text-sm">kJ</span
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
						class="text-muted ml-1 text-sm"
						>of {trophies.achievements.length}</span
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
				Riding pays best by a wide margin; the rest rewards being around. Being
				in voice is what counts — the server cannot hear who talks.
			</p>
			<div class="panel mt-3 overflow-x-auto">
				<table class="w-full text-sm">
					<thead>
						<tr
							class="text-muted text-left text-[10px] tracking-widest uppercase"
						>
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
	{/if}
</main>
