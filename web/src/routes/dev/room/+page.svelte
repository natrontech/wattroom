<script lang="ts">
	import IntervalGraph from './IntervalGraph.svelte';
	import RiderTile from './RiderTile.svelte';
	import RoomRail from './RoomRail.svelte';
	import SidePanel from './SidePanel.svelte';
	import TargetWidget, {
		TARGET_VARIANTS,
		type TargetVariant,
	} from './TargetWidget.svelte';
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
	const live = $derived(room.phase === 'live');

	let variant = $state<TargetVariant>('band');

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
		{ label: 'exec', value: `${Math.round(you.execution * 100)}%` },
	]);
</script>

<div class="flex h-[calc(100vh-45px)]">
	<RoomRail {you} {live} />

	<main class="flex min-w-0 flex-1 flex-col overflow-y-auto px-5 py-4">
		<header class="flex flex-wrap items-center gap-x-5 gap-y-2 pb-4">
			<div>
				<h1 class="font-display text-lg leading-tight font-bold">
					Thursday Sufferfest
				</h1>
				<p class="text-muted text-xs">
					{room.riders.length} riders ·
					{#if room.phase === 'lounge'}
						{speaking ? `${speaking.name} is talking` : 'idle'}
					{:else}
						{workout.name}
					{/if}
				</p>
			</div>

			<!-- Dev-only: the real transition is the coach's start button. -->
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

			{#if live}
				<div class="text-right">
					<div
						class="font-display text-2xl leading-none font-bold tabular-nums"
					>
						{clock(room.elapsed)}
					</div>
					<div class="text-muted text-[10px] tracking-wider uppercase">
						elapsed
					</div>
				</div>
			{/if}
		</header>

		<!-- Rider tiles: camera and power fused, so there is one grid rather than three. -->
		<div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
			{#each room.riders as rider (rider.name)}
				<RiderTile {rider} phase={room.phase} />
			{/each}
		</div>

		{#if room.phase === 'countdown'}
			<div
				class="border-neon/40 bg-surface-raised mt-3 flex items-center justify-center gap-4 rounded-lg border py-6"
			>
				<span
					class="text-watt glow-text-strong font-display text-5xl leading-none font-bold tabular-nums"
					>{room.countdown}</span
				>
				<div>
					<p class="font-display font-bold">{workout.name}</p>
					<p class="text-muted text-xs">
						Nina is starting the session — get pedalling
					</p>
				</div>
			</div>
		{:else if live}
			<div class="mt-3 flex items-center gap-2">
				<span class="text-muted text-[10px] tracking-[0.2em] uppercase"
					>target visual</span
				>
				{#each TARGET_VARIANTS as option (option.id)}
					<button
						onclick={() => (variant = option.id)}
						class="rounded px-2 py-1 text-xs {variant === option.id
							? 'bg-surface-raised text-white'
							: 'text-muted hover:text-white'}">{option.label}</button
					>
				{/each}
				<div class="ml-auto flex gap-5">
					{#each readouts as readout (readout.label)}
						<div class="text-right">
							<span
								class="font-display text-lg leading-none font-semibold tabular-nums"
								>{readout.value}</span
							>
							<span class="text-muted ml-1 text-[10px] tracking-wider uppercase"
								>{readout.label}</span
							>
						</div>
					{/each}
					<div class="text-right">
						<span
							class="font-display text-lg leading-none font-semibold {ZONE_TEXT[
								zone
							]}">Z{zone}</span
						>
						<span class="text-muted ml-1 text-[10px] tracking-wider uppercase"
							>zone</span
						>
					</div>
				</div>
			</div>

			<div class="mt-2">
				<TargetWidget {you} {variant} />
			</div>
			<div class="mt-2 overflow-hidden rounded-lg">
				<IntervalGraph
					segments={room.segments}
					total={room.total}
					elapsed={room.elapsed}
					ftp={you.ftp}
					trace={you.trace}
				/>
			</div>
		{:else}
			<div class="mt-3 flex flex-wrap items-center gap-3">
				<button
					class="rounded bg-white px-4 py-2 text-sm font-medium text-black hover:bg-white/90"
					>Start {workout.name}</button
				>
				<button
					class="border-muted/30 hover:border-muted/60 rounded border px-4 py-2 text-sm"
					>Change workout</button
				>
			</div>
		{/if}
	</main>

	<SidePanel {live} />
</div>
