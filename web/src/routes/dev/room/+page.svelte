<script lang="ts">
	import FaultBanner from './FaultBanner.svelte';
	import IntervalGraph from './IntervalGraph.svelte';
	import IntervalStrip from './IntervalStrip.svelte';
	import PlayerTile from './PlayerTile.svelte';
	import RiderTile from './RiderTile.svelte';
	import RoomRail from './RoomRail.svelte';
	import SidePanel from './SidePanel.svelte';
	import TargetWidget from './TargetWidget.svelte';
	import TvMode from './TvMode.svelte';
	import {
		createRoom,
		formatClock,
		ROOM_NAME,
		TILE_METRICS,
		type TileMetric,
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

	let tv = $state(false);

	/** WATTROOM.md: user-switchable layouts. One grid, three weightings. */
	type Layout = 'metrics' | 'video' | 'media';
	const layouts: { id: Layout; label: string }[] = [
		{ id: 'metrics', label: 'Metrics' },
		{ id: 'video', label: 'Video' },
		{ id: 'media', label: 'Media' },
	];
	let layout = $state<Layout>('metrics');

	// Zwift shows everyone's HR; whether you want it on every tile is taste, so it's a toggle.
	let tileMetrics = $state<TileMetric[]>(['hr']);
	function toggleMetric(id: TileMetric) {
		tileMetrics = tileMetrics.includes(id)
			? tileMetrics.filter((m) => m !== id)
			: [...tileMetrics, id];
	}

	// Video-first trades columns for tile size; media-focus demotes riders to a strip.
	const riderGrid = $derived(
		layout === 'media'
			? 'shrink-0 grid-cols-3 sm:grid-cols-6'
			: layout === 'video'
				? 'min-h-0 flex-1 grid-rows-3 sm:grid-cols-2 sm:grid-rows-3 xl:grid-cols-3 xl:grid-rows-2'
				: 'shrink-0 sm:grid-cols-2 xl:grid-cols-3',
	);

	const phases: { id: Phase; label: string }[] = [
		{ id: 'lounge', label: 'Lounge' },
		{ id: 'countdown', label: 'Countdown' },
		{ id: 'live', label: 'Live' },
	];

	const readouts = $derived([
		{ label: 'rpm', value: String(you.cadence) },
		{ label: 'bpm', value: String(you.hr) },
		{ label: 'w/kg', value: (you.watts / you.kg).toFixed(1) },
		{ label: 'exec', value: `${Math.round(you.execution * 100)}%` },
	]);
</script>

{#if tv}
	<div class="relative h-full">
		<button
			onclick={() => (tv = false)}
			class="border-muted/30 text-muted absolute bottom-4 left-4 z-10 rounded border px-3 py-1.5 text-xs hover:text-white"
			>Exit TV mode</button
		>
		<TvMode
			riders={room.riders}
			segments={room.segments}
			total={room.total}
			elapsed={room.elapsed}
			block={room.block}
		/>
	</div>
{:else}
	<div class="flex h-full">
		<RoomRail {you} {live} />

		<main class="flex min-w-0 flex-1 flex-col overflow-hidden px-5 py-4">
			<header class="flex flex-wrap items-center gap-x-5 gap-y-2 pb-4">
				<div>
					<h1 class="font-display text-lg leading-tight font-bold">
						{ROOM_NAME}
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
				<div class="border-muted/20 flex gap-1 rounded border p-0.5">
					{#each layouts as option (option.id)}
						<button
							onclick={() => (layout = option.id)}
							class="rounded px-2.5 py-1 text-xs {layout === option.id
								? 'bg-surface-raised text-white'
								: 'text-muted hover:text-white'}">{option.label}</button
						>
					{/each}
				</div>
				<div class="border-muted/20 flex gap-1 rounded border p-0.5">
					{#each TILE_METRICS as metric (metric.id)}
						<button
							onclick={() => toggleMetric(metric.id)}
							class="rounded px-2 py-1 text-xs {tileMetrics.includes(metric.id)
								? 'bg-surface-raised text-white'
								: 'text-muted hover:text-white'}">{metric.label}</button
						>
					{/each}
				</div>
				<div class="border-muted/20 flex gap-1 rounded border p-0.5">
					<button
						onclick={() => room.breakTrainer(true)}
						class="text-muted rounded px-2 py-1 text-xs hover:text-white"
						>Drop trainer</button
					>
					<button
						onclick={() => room.breakRoom(false)}
						class="text-muted rounded px-2 py-1 text-xs hover:text-white"
						>Drop room</button
					>
				</div>
				<button
					onclick={() => (tv = true)}
					class="border-muted/20 text-muted rounded border px-2.5 py-1 text-xs hover:text-white"
					>TV mode</button
				>

				{#if live}
					<div class="text-right">
						<div
							class="font-display text-2xl leading-none font-bold tabular-nums"
						>
							{formatClock(room.elapsed)}
						</div>
						<div class="text-muted text-[10px] tracking-wider uppercase">
							elapsed
						</div>
					</div>
				{/if}
			</header>

			{#if room.fault}
				<div class="mb-3">
					<FaultBanner
						fault={room.fault}
						bufferedSeconds={room.bufferedSeconds}
						onRecover={() => room.recover()}
					/>
				</div>
			{/if}

			{#if layout === 'media'}
				<!-- Media-focus: the player takes the main area, riders drop to a strip beneath it. -->
				<div class="flex min-h-0 flex-1 justify-center">
					<PlayerTile tall />
				</div>
			{/if}

			<!-- Rider tiles: camera and power fused, so there is one grid rather than three. -->
			<div class="grid gap-3 {riderGrid} {layout === 'media' ? 'mt-3' : ''}">
				{#each room.riders as rider (rider.name)}
					<RiderTile
						{rider}
						phase={room.phase}
						stretch={layout === 'video'}
						metrics={tileMetrics}
					/>
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
				<div class="mt-3 flex items-center justify-end gap-5">
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

				<div class="mt-2">
					<IntervalStrip
						block={room.block}
						bias={room.bias}
						onBias={(step) => room.nudgeBias(step)}
					/>
				</div>
				<div class="mt-2">
					<TargetWidget {you} variant="notch" compact={layout !== 'metrics'} />
				</div>
				<div class="mt-2 overflow-hidden rounded-lg">
					<IntervalGraph
						segments={room.segments}
						total={room.total}
						elapsed={room.elapsed}
						ftp={you.ftp}
						trace={you.trace}
						compact={layout !== 'metrics'}
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

		<SidePanel {live} showPlayer={layout !== 'media'} />
	</div>
{/if}
