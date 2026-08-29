<script lang="ts">
	import { formatClock, ZONE_TEXT, zoneOf } from '$lib/components/zones';
	import type { Rider, RiderMetrics, SessionState } from '$lib/protocol';

	// TV mode (#22): the room on a screen three meters away. Huge numbers,
	// nothing interactive except leaving — a TV is not a control surface.
	let {
		roster,
		riders,
		shared,
		exit,
	}: {
		roster: Rider[];
		riders: Record<string, RiderMetrics>;
		shared: SessionState | undefined;
		exit: () => void;
	} = $props();

	const ranked = $derived(
		[...roster]
			.map((rider) => ({ ...rider, metrics: riders[rider.id] }))
			.sort(
				(a, b) =>
					(b.metrics?.watts ?? 0) / Math.max(1, b.ftpWatts) -
					(a.metrics?.watts ?? 0) / Math.max(1, a.ftpWatts),
			),
	);
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && exit()} />

<div class="bg-surface fixed inset-0 z-50 flex flex-col p-8 text-white">
	<header class="flex items-baseline gap-6">
		{#if shared?.phase === 'countdown'}
			<span
				class="text-watt glow-text-strong font-display text-9xl font-bold tabular-nums"
				>{shared.countdownRemaining}</span
			>
		{:else if shared && shared.phase !== 'idle'}
			<span class="font-display text-8xl font-bold tabular-nums"
				>{formatClock(shared.elapsed)}</span
			>
			<span class="text-muted font-display text-3xl"
				>{shared.workoutName}{shared.phase === 'paused'
					? ' · paused'
					: ''}</span
			>
		{:else}
			<span class="text-muted font-display text-5xl">lounge</span>
		{/if}
		<button
			onclick={exit}
			class="text-muted ml-auto text-sm underline hover:text-white"
			>exit (esc)</button
		>
	</header>

	<div
		class="mt-8 grid flex-1 content-start gap-6"
		style="grid-template-columns: repeat(auto-fit, minmax(320px, 1fr))"
	>
		{#each ranked as rider (rider.id)}
			{@const watts = rider.metrics?.watts ?? 0}
			{@const zone = zoneOf(watts, rider.ftpWatts)}
			<div class="border-muted/15 rounded-2xl border p-6">
				<p class="font-display truncate text-3xl font-bold">{rider.name}</p>
				<div class="mt-2 flex items-baseline gap-3">
					<span
						class="text-watt glow-text-strong font-display text-8xl leading-none font-bold tabular-nums"
						>{watts}</span
					>
					<span class="text-muted text-3xl">W</span>
				</div>
				<p class="mt-3 text-2xl {ZONE_TEXT[zone]} font-display tabular-nums">
					Z{zone} · {rider.ftpWatts > 0
						? Math.round((watts / rider.ftpWatts) * 100)
						: 0}%
				</p>
			</div>
		{/each}
	</div>
</div>
