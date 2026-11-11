<script lang="ts">
	// The start line (#3228): a session picked on a road, before its count-in.
	// The road the crew is about to ride, who is on the line and what they
	// have ready, who said they would come and is not here yet, and the one
	// button each person needs — the coach's Start the ride, everyone else's
	// Join the start line. Drawn like the plan card above it: the riding
	// screen's layout is open for the redesign (WATTROOM.md), so this is a
	// panel in the voice channel and nothing on the ride.
	import { account } from '#lib/account.svelte.ts';
	import { channelConnection } from '#lib/channel/connection.svelte.ts';
	import { useChannel } from '#lib/channel/context.ts';
	import { device, spectatorRideLine } from '#lib/device.svelte.ts';
	import { formatDuration } from '#lib/format.ts';
	import TrainerOverview from '#lib/session/TrainerOverview.svelte';
	import { needsTrainer } from '#lib/session/sensor-status.ts';
	import { roadCard, startLineView } from '#lib/session/start-line.ts';
	import { roadOf } from '#lib/workout/road-workout.ts';
	import Bike from '@lucide/svelte/icons/bike';
	import Flag from '@lucide/svelte/icons/flag';
	import HeartPulse from '@lucide/svelte/icons/heart-pulse';

	const channel = useChannel();
	const live = $derived(channelConnection.current?.live);
	const tick = $derived(live?.tick);
	const line = $derived(tick?.startLine);
	const view = $derived(
		line && tick ? startLineView(line, tick.roster, account.me?.id) : null,
	);
	const card = $derived.by(() => {
		const route = tick?.state.route;
		if (!route) return null;
		const workout = channelConnection.current?.workout() ?? null;
		return roadCard(
			route,
			workout ? roadOf(workout) : null,
			workout,
			tick?.state.totalSeconds ?? 0,
		);
	});
	const unpaired = $derived(needsTrainer(channel.trainer, channel.pairing));

	function start() {
		// The coach's tab goes to the ride once the count-in opens it (#2599).
		live?.follow();
		channel.control('start');
	}
</script>

{#if view && card}
	<section class="panel mt-4" aria-label="start line">
		<div class="flex items-start gap-3">
			<Flag size={16} class="text-muted mt-1 shrink-0" />
			<div class="min-w-0 flex-1">
				<p class="eyebrow">start line</p>
				<p class="font-display truncate text-base font-bold">{card.name}</p>
				<p class="text-muted num mt-0.5 text-xs">
					km {card.fromKm}–{card.toKm} · {formatDuration(card.seconds)} at crew pace
				</p>
				{#if card.chips.length || card.terrainKm}
					<div class="mt-1.5 flex flex-wrap items-center gap-1.5">
						{#each card.chips as cls, i (cls)}
							<!-- RouteRow's chips: the hardest filled, the rest outlined. -->
							<span
								class="font-display rounded px-2 text-xs leading-5 font-bold {i ===
								0
									? 'bg-neon text-on-neon'
									: 'border-neon/60 border'}">{cls}</span
							>
						{/each}
						{#if card.terrainKm}
							<span class="text-muted text-xs"
								>Terrain Match starts at km {card.terrainKm}</span
							>
						{/if}
					</div>
				{/if}
			</div>
		</div>

		<ul class="mt-3 grid gap-1.5" aria-label="on the line">
			{#each view.onLine as rider (rider.id)}
				<li
					class="border-frame flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 rounded border px-3 py-1.5"
				>
					<span class="min-w-0 flex-1 truncate text-sm font-medium"
						>{rider.name}{#if rider.you}<span class="text-muted font-normal"
								>{' (you)'}</span
							>{/if}</span
					>
					<span
						class="flex items-center gap-1 text-xs {rider.trainer
							? 'text-ink'
							: 'text-muted line-through opacity-60'}"
						title={rider.trainer ? 'trainer ready' : 'no trainer yet'}
						><Bike size={14} /> trainer</span
					>
					<span
						class="flex items-center gap-1 text-xs {rider.heartRate
							? 'text-ink'
							: 'text-muted line-through opacity-60'}"
						title={rider.heartRate ? 'heart rate on' : 'no heart rate'}
						><HeartPulse size={14} /> HR</span
					>
					<!-- ADR-0048: a number nobody chose says it is a guess. -->
					<span class="num text-xs {rider.ftpGuess ? 'text-muted' : 'text-ink'}"
						>{rider.ftp} W{rider.ftpGuess ? ' · guess' : ''}</span
					>
				</li>
			{:else}
				<li class="text-muted text-sm">Nobody is on the line yet.</li>
			{/each}
		</ul>
		<!-- Races add the grid by Category and the unranked reasons here (#3169). -->
		{#if view.beside.length}
			<p class="text-muted mt-2 text-xs">
				In the channel: {view.beside.join(', ')}
			</p>
		{/if}
		{#if view.awaited.length}
			<p class="text-muted mt-1 text-xs">
				Not here yet: {view.awaited.join(', ')}
			</p>
		{/if}

		<div class="mt-3 flex flex-wrap items-center gap-2">
			{#if channel.canDrive}
				<button
					onclick={start}
					disabled={!!view.wait}
					class="btn btn-primary btn-lg">Start the ride</button
				>
			{/if}
			{#if device.spectator}
				<p class="text-muted text-sm">{spectatorRideLine}</p>
			{:else if view.youOn}
				{#if unpaired}<TrainerOverview compact />{/if}
				<button
					onclick={() => channel.control('leave')}
					class="btn btn-secondary btn-lg">Leave the start line</button
				>
			{:else}
				<button
					onclick={() => channel.control('join')}
					class="btn btn-accent btn-lg">Join the start line</button
				>
			{/if}
		</div>
		{#if channel.canDrive && view.wait}
			<p class="text-muted mt-2 text-sm">{view.wait}</p>
		{/if}
	</section>
{/if}
