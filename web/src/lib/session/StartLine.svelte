<script lang="ts">
	// The start line (#3228): a session picked on a road, before its count-in.
	// The road the crew is about to ride, who is on the line and what they
	// have ready, who said they would come and is not here yet, and the one
	// button each person needs — the coach's Start the ride, everyone else's
	// Join the start line. Drawn like the plan card above it: the riding
	// screen's layout is open for the redesign (WATTROOM.md), so this is a
	// panel, never part of the ride. A road session opens on the crew's own
	// session page (#4389), which draws it in its Training place (#4504); a
	// voice channel's lounge draws it as well.
	import { account } from '#lib/account.svelte.ts';
	import { channelConnection } from '#lib/channel/connection.svelte.ts';
	import { useChannel } from '#lib/channel/context.ts';
	import { device, spectatorRideLine } from '#lib/device.svelte.ts';
	import { formatDuration } from '#lib/format.ts';
	import TrainerOverview from '#lib/session/TrainerOverview.svelte';
	import { needsTrainer } from '#lib/session/sensor-status.ts';
	import {
		roadCard,
		showsStartLine,
		startLineView,
	} from '#lib/session/start-line.ts';
	import { roadOf } from '#lib/workout/road-workout.ts';
	import Bike from '@lucide/svelte/icons/bike';
	import Flag from '@lucide/svelte/icons/flag';
	import HeartPulse from '@lucide/svelte/icons/heart-pulse';

	const channel = useChannel();
	// This place's own session (#4504): on the call's page beside a crew
	// session, `current` is that session, and its line is not the call's.
	const here = $derived(channelConnection.at(channel.address));
	const live = $derived(here?.live);
	const tick = $derived(live?.tick);
	const line = $derived(tick?.startLine);
	const view = $derived(
		line && tick && showsStartLine(tick)
			? startLineView(line, tick.roster, account.me?.id)
			: null,
	);
	const coachName = $derived(tick?.state.coachName || 'The coach');
	// A crew's own session has no channel around it: who is here and off the
	// line is watching.
	const besideWord = $derived(
		channel.address.channel ? 'In the channel' : 'Watching',
	);
	const card = $derived.by(() => {
		const route = tick?.state.route;
		if (!route) return null;
		const workout = here?.workout() ?? null;
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
				{besideWord}: {view.beside.join(', ')}
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
			{#if channel.canDrive}
				<!-- The coach's way out before the count-in (#4562): nothing is ridden yet, so it goes at once. -->
				<button
					onclick={() => channel.control('end')}
					class="btn btn-danger btn-lg ml-auto">Cancel session</button
				>
			{/if}
		</div>
		{#if channel.canDrive && view.wait}
			<p class="text-muted mt-2 text-sm">{view.wait}</p>
		{:else if !channel.canControl}
			<!-- Everyone else's wait (#4504): who starts it, and when. -->
			<p class="text-muted mt-2 text-sm">
				{coachName}
				{view.wait
					? 'starts the ride once a rider on the line has a trainer paired.'
					: 'starts the ride from here.'}
			</p>
		{/if}
	</section>
{/if}
