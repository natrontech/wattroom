<script lang="ts">
	import Logo from '$lib/brand/Logo.svelte';
	import IntervalGraph from '../room/IntervalGraph.svelte';
	import {
		ZONE_BG,
		type MockRider,
		type Phase,
		workout,
		zoneOf,
	} from '../room/mockRoom.svelte';
	import type { Segment } from '$lib/workout/types';

	let {
		riders,
		segments,
		total,
		elapsed,
		phase,
	}: {
		riders: MockRider[];
		segments: Segment[];
		total: number;
		elapsed: number;
		phase: Phase;
	} = $props();

	const live = $derived(phase === 'live');
	const ranked = $derived(
		[...riders].sort((a, b) => b.watts / b.ftp - a.watts / a.ftp),
	);

	// Spectators can only cheer (docs/SPEC.md roles matrix) — no riding, no voice, no jukebox.
	const cheers = ['🔥', '💪', '👏', '💀'];
	let sent = $state<string | null>(null);

	function cheer(emoji: string) {
		sent = emoji;
		setTimeout(() => (sent = null), 1200);
	}

	function clock(seconds: number): string {
		const m = Math.floor(seconds / 60);
		return `${m}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
	}
</script>

<div class="bg-surface flex h-full flex-col text-white">
	<header class="flex items-center gap-2.5 border-b border-white/5 px-4 py-3">
		<Logo size={22} {live} />
		<div class="min-w-0">
			<p class="truncate text-sm font-medium">Thursday Sufferfest</p>
			<p class="text-muted truncate text-[11px]">
				{live ? workout.name : 'in the lounge'}
			</p>
		</div>
		{#if live}
			<span
				class="font-display ml-auto text-lg leading-none font-bold tabular-nums"
				>{clock(elapsed)}</span
			>
		{/if}
	</header>

	{#if live}
		<ul class="flex-1 overflow-y-auto">
			{#each ranked as rider (rider.name)}
				{@const zone = zoneOf(rider.watts, rider.ftp)}
				<li class="border-b border-white/5 px-4 py-2.5">
					<div class="flex items-baseline gap-2">
						<span class="truncate text-sm">{rider.name}</span>
						{#if rider.coach}
							<span class="text-muted text-[9px] tracking-wider uppercase"
								>coach</span
							>
						{/if}
						<span
							class="font-display ml-auto text-2xl leading-none font-bold tabular-nums"
							>{rider.watts}</span
						>
						<span class="text-muted text-[10px]">W</span>
					</div>
					<div class="mt-1.5 flex items-center gap-2">
						<div
							class="bg-surface-raised h-1.5 flex-1 overflow-hidden rounded-full"
						>
							<div
								class="h-full transition-[width] duration-500 {ZONE_BG[zone]}"
								style="width: {Math.min(
									100,
									(rider.watts / rider.ftp / 1.5) * 100,
								)}%"
							></div>
						</div>
						<span
							class="text-muted w-16 text-right font-mono text-[10px] tabular-nums"
							>{(rider.watts / rider.kg).toFixed(1)} w/kg</span
						>
					</div>
				</li>
			{/each}
		</ul>

		<div class="border-t border-white/5">
			<IntervalGraph
				{segments}
				{total}
				{elapsed}
				ftp={ranked[0].ftp}
				trace={[]}
				compact
			/>
		</div>
	{:else}
		<!-- Empty states teach, never apologise (.claude/rules/ux.md). -->
		<div
			class="flex flex-1 flex-col items-center justify-center px-8 text-center"
		>
			<Logo size={48} />
			<p class="mt-5 text-sm">Nobody's riding yet.</p>
			<p class="text-muted mt-2 text-xs leading-relaxed">
				You'll see everyone's live power here the moment the coach starts the
				session. Cheers still land in the room.
			</p>
		</div>
	{/if}

	<!-- Huge tap targets: this is used one-handed, often standing up. -->
	<div class="relative border-t border-white/5 p-3">
		<div class="flex gap-2">
			{#each cheers as emoji (emoji)}
				<button
					onclick={() => cheer(emoji)}
					class="border-muted/20 active:bg-surface-raised flex-1 rounded-lg border py-4 text-2xl"
					>{emoji}</button
				>
			{/each}
		</div>
		<p class="text-muted mt-2 text-center text-[10px]">
			Spectating — read-only. Bring a laptop to ride.
		</p>
		{#if sent}
			<div
				class="text-watt glow-text pointer-events-none absolute inset-x-0 -top-6 text-center text-3xl"
			>
				{sent}
			</div>
		{/if}
	</div>
</div>
