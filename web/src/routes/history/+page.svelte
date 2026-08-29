<script lang="ts">
	import Logo from '$lib/brand/Logo.svelte';
	import { formatClock } from '$lib/components/zones';
	import { createHistoryStore } from '$lib/history.svelte';

	const history = createHistoryStore();
</script>

<main class="mx-auto max-w-3xl px-6 py-10">
	<div class="flex items-center gap-3">
		<Logo size={30} />
		<div>
			<h1 class="font-display text-2xl leading-tight font-bold">Rides</h1>
			<p class="text-muted text-xs">
				Private by default, and stored only on this device until accounts land.
			</p>
		</div>
	</div>

	{#if history.all.length === 0}
		<!-- Empty states teach (.claude/rules/ux.md). -->
		<div
			class="border-muted/15 mt-8 rounded-lg border border-dashed px-6 py-8 text-center"
		>
			<p class="text-sm">No rides yet.</p>
			<p class="text-muted mx-auto mt-2 max-w-sm text-xs leading-relaxed">
				Finish a workout and it lands here with its execution score. You can
				export any ride as a .fit for Strava or your head unit.
			</p>
			<a
				href="/workouts"
				class="mt-5 inline-block rounded bg-white px-4 py-2.5 text-sm font-medium text-black hover:bg-white/90"
				>Pick a workout</a
			>
		</div>
	{:else}
		<ul class="mt-8 grid gap-2">
			{#each history.all as ride (ride.id)}
				<li
					class="border-muted/15 bg-surface-raised flex flex-wrap items-baseline gap-x-4 gap-y-1 rounded-lg border px-5 py-4"
				>
					<span class="font-display font-bold">{ride.workoutName}</span>
					<span class="text-muted text-xs"
						>{new Date(ride.startedAt).toLocaleDateString()}</span
					>
					<span class="text-muted ml-auto font-mono text-xs tabular-nums"
						>{formatClock(ride.seconds)}</span
					>
					<span class="font-mono text-xs tabular-nums">{ride.avgWatts} W</span>
					<span class="text-muted font-mono text-xs tabular-nums"
						>{ride.kj} kJ</span
					>
					<span class="font-display text-sm font-semibold tabular-nums"
						>{Math.round(ride.execution * 100)}%</span
					>
				</li>
			{/each}
		</ul>
		<button
			onclick={() => history.clear()}
			class="border-z6/40 text-z6 hover:bg-z6/10 mt-4 rounded border px-4 py-2 text-xs"
			>Clear history</button
		>
	{/if}
</main>
