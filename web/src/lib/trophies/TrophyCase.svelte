<script lang="ts">
	// The trophy case (#1330): your level's receipts — what you have done
	// here, the medal shelf and where the XP came from. It was a page of its
	// own; it is the own rider's page now (identity, not settings). The
	// numbers it used to lead with are that page's: the level sits in its
	// header and energy beside the rides, so the case says neither twice.
	import EmptyState from '$lib/components/EmptyState.svelte';
	import RiderCounts from '$lib/trophies/RiderCounts.svelte';
	import TrophyShelf from '$lib/trophies/TrophyShelf.svelte';
	import { XP_SOURCES, type Trophies } from '$lib/trophies/trophies';

	let { trophies }: { trophies: Trophies } = $props();

	// One empty state for the whole case (ux.md): a rider with no XP has
	// nothing counted either, and two dashed boxes saying so is one too many.
	const nothingYet = $derived(
		trophies.xp.total === 0 && trophies.energyKj === 0,
	);
</script>

{#if nothingYet}
	<EmptyState>
		The case fills as you ride and as you hang out: every kJ is an XP, every
		five minutes in a lounge's voice channel is one more.
		{#snippet cta()}
			<a href="/workouts" class="btn btn-primary btn-xs">Ride a workout</a>
		{/snippet}
	</EmptyState>
{:else}
	<RiderCounts counts={trophies.counts} achievements={trophies.achievements} />

	<TrophyShelf {trophies} />

	<section>
		<h2 class="eyebrow">Where XP comes from</h2>
		<p class="text-muted mt-0.5 max-w-2xl text-xs">
			Riding pays best by a wide margin; the rest rewards being around. Being in
			voice is what counts — the server cannot hear who talks.
		</p>
		<div class="panel mt-3 overflow-x-auto">
			<table class="w-full text-sm">
				<thead>
					<tr class="eyebrow text-left">
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
				<tfoot>
					<tr class="border-ink/10 border-t">
						<td class="px-4 py-2 font-medium">Lifetime</td>
						<td class="text-muted px-4 py-2 text-xs"
							>{Math.round(
								(trophies.xp.rides / Math.max(1, trophies.xp.total)) * 100,
							)}% from riding</td
						>
						<td class="font-display px-4 py-2 text-right font-bold tabular-nums"
							>{trophies.xp.total.toLocaleString()} XP</td
						>
					</tr>
				</tfoot>
			</table>
		</div>
	</section>
{/if}
