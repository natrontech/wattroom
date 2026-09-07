<script lang="ts">
	// This ride against your own best of it (#996). The only comparison on the
	// ride page that needs no privacy argument: no other rider's data is
	// involved, so it touches nothing rides-private-by-default protects.
	//
	// Describe, never grade (ADR-0016). A negative delta takes the muted token,
	// never --color-danger: danger means something is wrong, and a lighter day
	// is not wrong.
	import EmptyState from '$lib/components/EmptyState.svelte';
	import type { RideRecord } from '$lib/history.svelte';
	import { bestOfWorkout, compareRows, curveSentence } from './compare';

	let {
		ride,
		rides,
		d30,
		d90,
	}: {
		ride: RideRecord;
		/** Every ride the rider has; null while it is still loading or failed. */
		rides: RideRecord[] | null;
		d30?: number;
		d90?: number;
	} = $props();

	const best = $derived(
		rides ? bestOfWorkout(rides, ride.workoutName, ride.id) : null,
	);
	const rows = $derived(best ? compareRows(ride, best) : []);
	const bestWhen = $derived(
		best
			? new Date(best.startedAt).toLocaleDateString(undefined, {
					month: 'short',
					day: 'numeric',
				})
			: '',
	);
	const curve = $derived(curveSentence(d30 ?? 0, d90 ?? 0));
</script>

<section>
	<div class="flex items-baseline gap-3">
		<h2 class="text-muted text-xs font-semibold tracking-widest uppercase">
			Against your best
		</h2>
		<!-- ADR-0016: every load-derived surface says what it is scoped to. -->
		<span class="text-muted/70 text-[11px]">based on your WattRoom rides</span>
	</div>

	{#if rides === null}
		<p class="text-muted mt-3 text-xs">Your other rides could not be loaded.</p>
	{:else if !best}
		<div class="mt-3">
			<EmptyState>
				First time you have ridden {ride.workoutName}. Ride it again and this is
				where the two sit side by side.
			</EmptyState>
		</div>
	{:else}
		<div class="panel mt-3 overflow-x-auto">
			<table class="w-full text-sm">
				<thead>
					<tr
						class="text-muted text-left text-[10px] tracking-widest uppercase"
					>
						<th class="px-4 py-2"></th>
						<th class="px-4 py-2 text-right">this ride</th>
						<th class="px-4 py-2 text-right">your best · {bestWhen}</th>
						<th class="px-4 py-2 text-right">Δ</th>
					</tr>
				</thead>
				<tbody>
					{#each rows as row (row.label)}
						<tr class="border-ink/5 border-t">
							<td class="text-muted px-4 py-2 text-xs">{row.label}</td>
							<td
								class="font-display px-4 py-2 text-right font-semibold tabular-nums"
								>{row.today}</td
							>
							<td class="text-muted px-4 py-2 text-right tabular-nums"
								>{row.best}</td
							>
							<td class="text-muted px-4 py-2 text-right text-xs tabular-nums"
								>{row.delta}</td
							>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}

	{#if curve}
		<p class="text-muted mt-3 text-xs">{curve}</p>
	{/if}
</section>
