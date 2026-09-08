<script lang="ts">
	import X from '@lucide/svelte/icons/x';
	import { formatClock } from '$lib/format';
	import { isStale, subscribeHud, type HudSnapshot } from '$lib/hud/feed';

	// The HUD (#296, ADR-0041): the rider's own numbers in a window of their
	// own — the shell floats it over whatever else is on screen while a ride
	// runs and WattRoom is not in front. A mirror of the riding screen through
	// the HUD feed; it reads no sensor and joins no room.
	let snapshot = $state<HudSnapshot | null>(null);
	let now = $state(Date.now());
	$effect(() => {
		const stop = subscribeHud((s) => (snapshot = s));
		const clock = setInterval(() => (now = Date.now()), 1000);
		return () => {
			stop();
			clearInterval(clock);
		};
	});
	const quiet = $derived(isStale(snapshot, now));
	const shell = (globalThis as { wattroom?: { hud?: (on: boolean) => void } })
		.wattroom;
	const onTarget = $derived(
		!!snapshot &&
			snapshot.target > 0 &&
			Math.abs(snapshot.watts - snapshot.target) <= snapshot.target * 0.05,
	);
</script>

<svelte:head><title>HUD · WattRoom</title></svelte:head>

<!-- Fills the shell's frameless window; draggable by its whole face, the
     close button excepted, so it can be moved without a title bar. -->
<main
	class="cave bg-surface text-ink relative flex h-dvh flex-col justify-center overflow-hidden px-5 py-3 select-none"
	style="-webkit-app-region: drag"
>
	{#if shell?.hud}
		<button
			onclick={() => shell.hud?.(false)}
			class="text-muted hover:text-ink absolute top-2 right-2 grid h-6 w-6 place-items-center rounded"
			style="-webkit-app-region: no-drag"
			aria-label="Close the HUD"><X size={14} /></button
		>
	{/if}
	{#if quiet || !snapshot}
		<p class="eyebrow">wattroom</p>
		<p class="text-muted mt-1 text-sm" data-testid="hud-quiet">
			Waiting for a ride…
		</p>
	{:else}
		<p class="eyebrow truncate" data-testid="hud-label">{snapshot.label}</p>
		<div class="mt-1 flex items-baseline gap-3">
			<span
				class="font-display text-watt glow-text text-5xl leading-none font-bold tabular-nums"
				data-testid="hud-watts">{Math.round(snapshot.watts)}</span
			>
			<span class="text-muted text-sm">w</span>
			{#if snapshot.target > 0}
				<span
					class="text-muted font-display ml-auto text-2xl leading-none tabular-nums {onTarget
						? 'text-ink'
						: ''}"
					data-testid="hud-target"
					>{Math.round(snapshot.target)}<span class="text-xs">
						target</span
					></span
				>
			{/if}
		</div>
		<p class="text-muted mt-2 text-xs tabular-nums" data-testid="hud-remaining">
			{formatClock(snapshot.remaining)} left
		</p>
	{/if}
</main>
