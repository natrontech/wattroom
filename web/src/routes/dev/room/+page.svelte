<script lang="ts">
	import Logo from '$lib/brand/Logo.svelte';
	import IntervalGraph from './IntervalGraph.svelte';
	import RiderTile from './RiderTile.svelte';
	import { createRoom, workout, ZONE_TEXT, zoneOf } from './mockRoom.svelte';

	const room = createRoom();
	$effect(() => {
		void room.start();
		return room.stop;
	});

	const you = $derived(room.riders.find((r) => r.you)!);
	const others = $derived(room.riders.filter((r) => !r.you));
	const zone = $derived(zoneOf(you.watts, you.ftp));

	function clock(seconds: number): string {
		const m = Math.floor(seconds / 60);
		const s = Math.floor(seconds % 60);
		return `${m}:${String(s).padStart(2, '0')}`;
	}
</script>

<main class="mx-auto max-w-6xl px-6 py-8">
	<!-- Room header -->
	<header class="flex flex-wrap items-center gap-x-6 gap-y-3">
		<Logo size={34} live />
		<div>
			<h1 class="font-display text-xl leading-tight font-bold">
				Thursday Sufferfest
			</h1>
			<p class="text-muted text-xs">{workout.name} · 6 riders</p>
		</div>
		<div class="ml-auto text-right">
			<div class="font-display text-3xl leading-none font-bold tabular-nums">
				{clock(room.elapsed)}
			</div>
			<div class="text-muted text-[10px] tracking-wider uppercase">elapsed</div>
		</div>
	</header>

	<!-- Your own numbers: the only tile allowed to glow -->
	<section class="border-muted/15 bg-surface-raised mt-6 rounded-lg border p-6">
		<div class="flex flex-wrap items-end gap-x-10 gap-y-6">
			<div>
				<div class="flex items-baseline gap-2">
					<span
						class="text-watt glow-text-strong font-display text-7xl leading-none font-bold tabular-nums"
						>{you.watts}</span
					>
					<span class="text-muted text-xl">W</span>
				</div>
				<div class="text-muted mt-1 text-[10px] tracking-wider uppercase">
					your power
				</div>
			</div>

			<div>
				<div
					class="font-display text-3xl leading-none font-semibold tabular-nums"
				>
					{you.target}
				</div>
				<div class="text-muted mt-1 text-[10px] tracking-wider uppercase">
					target
				</div>
			</div>
			<div>
				<div
					class="font-display text-3xl leading-none font-semibold tabular-nums"
				>
					{you.cadence}
				</div>
				<div class="text-muted mt-1 text-[10px] tracking-wider uppercase">
					rpm
				</div>
			</div>
			<div>
				<div
					class="font-display text-3xl leading-none font-semibold tabular-nums"
				>
					{you.hr}
				</div>
				<div class="text-muted mt-1 text-[10px] tracking-wider uppercase">
					bpm
				</div>
			</div>
			<div>
				<div
					class="font-display text-3xl leading-none font-semibold tabular-nums {ZONE_TEXT[
						zone
					]}"
				>
					Z{zone}
				</div>
				<div class="text-muted mt-1 text-[10px] tracking-wider uppercase">
					zone
				</div>
			</div>
			<div class="ml-auto text-right">
				<div
					class="font-display text-3xl leading-none font-semibold tabular-nums"
				>
					{Math.round(you.execution * 100)}%
				</div>
				<div class="text-muted mt-1 text-[10px] tracking-wider uppercase">
					execution
				</div>
			</div>
		</div>
	</section>

	<!-- Workout timeline -->
	<section
		class="border-muted/15 bg-surface-raised mt-3 overflow-hidden rounded-lg border"
	>
		<IntervalGraph
			segments={room.segments}
			total={room.total}
			elapsed={room.elapsed}
			ftp={you.ftp}
			trace={you.trace}
		/>
	</section>

	<!-- Everyone else -->
	<section class="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
		{#each others as rider (rider.name)}
			<RiderTile {rider} />
		{/each}
	</section>

	<p class="text-muted mt-6 text-xs">
		Every tile is a real <code class="text-white/70">SimulatedTrainer</code> holding
		a real ERG target. Workout clock runs at 8× so the timeline moves; sampling is
		the true 1 Hz.
	</p>
</main>
