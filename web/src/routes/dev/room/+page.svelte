<script lang="ts">
	import Logo from '$lib/brand/Logo.svelte';
	import Horizon from './Horizon.svelte';
	import IntervalGraph from './IntervalGraph.svelte';
	import { createRoom, workout, ZONE_TEXT, zoneOf } from './mockRoom.svelte';

	const room = createRoom();
	$effect(() => {
		void room.start();
		return room.stop;
	});

	const you = $derived(room.riders.find((r) => r.you)!);
	const zone = $derived(zoneOf(you.watts, you.ftp));

	function clock(seconds: number): string {
		const m = Math.floor(seconds / 60);
		return `${m}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
	}

	// A bare readout row, not cards — the scene is the interface.
	const readouts = $derived([
		{ label: 'rpm', value: String(you.cadence) },
		{ label: 'bpm', value: String(you.hr) },
		{ label: 'w/kg', value: (you.watts / you.kg).toFixed(1) },
		{ label: 'execution', value: `${Math.round(you.execution * 100)}%` },
	]);
</script>

<main class="mx-auto max-w-6xl px-6 py-6">
	<header class="flex flex-wrap items-center gap-x-6 gap-y-3 pb-4">
		<Logo size={30} live />
		<div>
			<h1 class="font-display text-lg leading-tight font-bold">
				Thursday Sufferfest
			</h1>
			<p class="text-muted text-xs">{workout.name} · 6 riders</p>
		</div>
		<div class="ml-auto text-right">
			<div class="font-display text-2xl leading-none font-bold tabular-nums">
				{clock(room.elapsed)}
			</div>
			<div class="text-muted text-[10px] tracking-wider uppercase">elapsed</div>
		</div>
	</header>

	<Horizon riders={room.riders} progress={room.elapsed / room.total} />

	<div class="mt-4 flex flex-wrap items-baseline gap-x-10 gap-y-3">
		{#each readouts as readout (readout.label)}
			<div class="flex items-baseline gap-2">
				<span
					class="font-display text-2xl leading-none font-semibold tabular-nums"
					>{readout.value}</span
				>
				<span class="text-muted text-[10px] tracking-wider uppercase"
					>{readout.label}</span
				>
			</div>
		{/each}
		<div class="flex items-baseline gap-2">
			<span
				class="font-display text-2xl leading-none font-semibold tabular-nums {ZONE_TEXT[
					zone
				]}">Z{zone}</span
			>
			<span class="text-muted text-[10px] tracking-wider uppercase">zone</span>
		</div>
	</div>

	<div class="mt-4 overflow-hidden rounded-lg">
		<IntervalGraph
			segments={room.segments}
			total={room.total}
			elapsed={room.elapsed}
			ftp={you.ftp}
			trace={you.trace}
		/>
	</div>

	<p class="text-muted mt-4 text-xs">
		The horizon is your target; you ride above or below it. The corridor is the
		SPEC tolerance band, the ground scrolls at the room's collective effort, and
		the sun sets as the session runs down.
	</p>
</main>
