<script lang="ts">
	import Logo from '$lib/brand/Logo.svelte';
	import EffortBand from './EffortBand.svelte';
	import IntervalGraph from './IntervalGraph.svelte';
	import Jukebox from './Jukebox.svelte';
	import RiderTile from './RiderTile.svelte';
	import {
		createRoom,
		workout,
		ZONE_TEXT,
		zoneOf,
		type Phase,
	} from './mockRoom.svelte';

	const room = createRoom();
	$effect(() => {
		void room.start();
		return room.stop;
	});

	const you = $derived(room.riders.find((r) => r.you)!);
	const zone = $derived(zoneOf(you.watts, you.ftp));
	const speaking = $derived(room.riders.find((r) => r.speaking));

	const phases: { id: Phase; label: string }[] = [
		{ id: 'lounge', label: 'Lounge' },
		{ id: 'countdown', label: 'Countdown' },
		{ id: 'live', label: 'Live' },
	];

	function clock(seconds: number): string {
		const m = Math.floor(seconds / 60);
		return `${m}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
	}

	const readouts = $derived([
		{ label: 'rpm', value: String(you.cadence) },
		{ label: 'bpm', value: String(you.hr) },
		{ label: 'w/kg', value: (you.watts / you.kg).toFixed(1) },
		{ label: 'execution', value: `${Math.round(you.execution * 100)}%` },
	]);
</script>

<main class="mx-auto max-w-[1400px] px-6 py-5">
	<header class="flex flex-wrap items-center gap-x-6 gap-y-3 pb-5">
		<Logo size={30} live={room.phase === 'live'} />
		<div>
			<h1 class="font-display text-lg leading-tight font-bold">
				Thursday Sufferfest
			</h1>
			<p class="text-muted text-xs">
				{room.riders.length} riders ·
				{#if room.phase === 'lounge'}
					waiting on Nina to start {workout.name}
				{:else}
					{workout.name}
				{/if}
			</p>
		</div>

		<!-- Dev-only phase control; the real thing is the coach's start button. -->
		<div class="border-muted/20 ml-auto flex gap-1 rounded border p-0.5">
			{#each phases as option (option.id)}
				<button
					onclick={() => room.setPhase(option.id)}
					class="rounded px-2.5 py-1 text-xs {room.phase === option.id
						? 'bg-surface-raised text-white'
						: 'text-muted hover:text-white'}">{option.label}</button
				>
			{/each}
		</div>

		{#if room.phase === 'live'}
			<div class="text-right">
				<div class="font-display text-2xl leading-none font-bold tabular-nums">
					{clock(room.elapsed)}
				</div>
				<div class="text-muted text-[10px] tracking-wider uppercase">
					elapsed
				</div>
			</div>
		{/if}
	</header>

	<!-- One grid: riders and the player are the same kind of citizen. -->
	<div class="grid gap-4 lg:grid-cols-[1fr_300px]">
		<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
			{#each room.riders as rider (rider.name)}
				<RiderTile {rider} phase={room.phase} />
			{/each}
		</div>
		<Jukebox />
	</div>

	{#if room.phase === 'countdown'}
		<div
			class="border-neon/40 bg-surface-raised mt-4 flex items-center justify-center gap-4 rounded-lg border py-8"
		>
			<span
				class="text-watt glow-text-strong font-display text-6xl leading-none font-bold tabular-nums"
				>{room.countdown}</span
			>
			<div>
				<p class="font-display text-lg font-bold">{workout.name}</p>
				<p class="text-muted text-xs">
					Nina is starting the session — get pedalling
				</p>
			</div>
		</div>
	{:else if room.phase === 'live'}
		<div class="mt-4 grid gap-4 lg:grid-cols-[1fr_300px]">
			<div class="grid gap-3">
				<EffortBand {you} />
				<div class="overflow-hidden rounded-lg">
					<IntervalGraph
						segments={room.segments}
						total={room.total}
						elapsed={room.elapsed}
						ftp={you.ftp}
						trace={you.trace}
					/>
				</div>
			</div>
			<div class="flex flex-wrap content-start gap-x-6 gap-y-4">
				{#each readouts as readout (readout.label)}
					<div>
						<div
							class="font-display text-2xl leading-none font-semibold tabular-nums"
						>
							{readout.value}
						</div>
						<div class="text-muted mt-1 text-[10px] tracking-wider uppercase">
							{readout.label}
						</div>
					</div>
				{/each}
				<div>
					<div
						class="font-display text-2xl leading-none font-semibold tabular-nums {ZONE_TEXT[
							zone
						]}"
					>
						Z{zone}
					</div>
					<div class="text-muted mt-1 text-[10px] tracking-wider uppercase">
						zone
					</div>
				</div>
			</div>
		</div>
	{:else}
		<div class="mt-4 flex flex-wrap items-center gap-4">
			<button
				class="rounded bg-white px-4 py-2 text-sm font-medium text-black hover:bg-white/90"
				>Start {workout.name}</button
			>
			<button
				class="border-muted/30 hover:border-muted/60 rounded border px-4 py-2 text-sm"
				>Change workout</button
			>
			<span class="text-muted text-xs">
				{speaking ? `${speaking.name} is talking` : 'nobody is talking'}
			</span>
		</div>
	{/if}
</main>
