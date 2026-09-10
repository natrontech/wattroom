<script lang="ts">
	// Home's last three rides (#1333 split it out for size): each opens the
	// ride's own page (#1331), and the list links to the rest.
	import { formatWhen } from '$lib/format';

	let {
		rides,
	}: {
		rides: { id: string; startedAt: string; seconds: number; kj: number }[];
	} = $props();
	const recent = $derived(rides);
</script>

{#if recent.length === 0}
	<!-- Empty states teach (ux.md, #1862): the section used to vanish
	     whole, and a fresh account was never told the app keeps a ride log. -->
	<section>
		<h2 class="eyebrow">Recent rides</h2>
		<p class="text-muted mt-2 text-sm">
			No rides yet — every ride you finish lands here.
			<a href="/workouts" class="btn-link">Ride solo</a>
		</p>
	</section>
{:else}
	<section>
		<div class="flex items-baseline gap-3">
			<h2 class="eyebrow">Recent rides</h2>
			<a href="/history" class="btn-link ml-auto text-xs">All rides →</a>
		</div>
		<ul class="panel divide-ink/5 mt-3 divide-y">
			{#each recent as ride (ride.id)}
				<li>
					<a
						href="/history/{ride.id}"
						class="hover:bg-surface flex items-center gap-3 px-4 py-2.5 text-sm transition-colors"
					>
						<span class="text-muted w-24 shrink-0 text-xs"
							>{formatWhen(ride.startedAt)}</span
						>
						<span class="min-w-0 flex-1 truncate">
							{Math.round(ride.seconds / 60)} min
						</span>
						<span class="text-muted shrink-0 text-xs tabular-nums"
							>{Math.round(ride.kj).toLocaleString()} kJ</span
						>
					</a>
				</li>
			{/each}
		</ul>
	</section>
{/if}
