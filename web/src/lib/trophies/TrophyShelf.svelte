<script lang="ts">
	// The trophy case (#467): a rider's own medals and their badges. Pure —
	// hand it a Trophies payload and it draws. Only /trophies uses it: a
	// rider's page shows BadgeGrid alone, because these medal counts are
	// lifetime and ADR-0024 lets that page show only the ones from rooms you
	// share (#701).
	import { Award } from '@lucide/svelte';
	import { MEDAL_KINDS, MEDAL_META } from '$lib/medals';
	import BadgeGrid from './BadgeGrid.svelte';
	import { MEDAL_COUNT_KEY, type Trophies } from './trophies';

	let { trophies }: { trophies: Trophies } = $props();

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

<BadgeGrid achievements={trophies.achievements} />
