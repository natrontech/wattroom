<script lang="ts">
	import {
		type MockRider,
		type SprintResult,
		type SprintState,
	} from './mockRoom.svelte';

	let {
		state,
		secondsLeft,
		riders,
		podium,
	}: {
		state: SprintState;
		secondsLeft: number;
		riders: MockRider[];
		podium: SprintResult[];
	} = $props();

	// The battle is w/kg, not watts — that is what makes a 62 kg climber and an 83 kg
	// rouleur the same race. Bars scale to the current leader, so the gap is the story.
	const battle = $derived.by(() => {
		const scored = riders
			.map((rider) => ({
				name: rider.name,
				you: rider.you,
				wkg: rider.watts / rider.kg,
				watts: rider.watts,
			}))
			.sort((a, b) => b.wkg - a.wkg);
		const top = Math.max(1, scored[0]?.wkg ?? 1);
		return scored.map((entry) => ({ ...entry, pct: (entry.wkg / top) * 100 }));
	});

	const places = ['1st', '2nd', '3rd'];
</script>

<!-- Sprint moments are the one place the UI is allowed to go loud (WATTROOM.md §7). -->
<div
	class="border-watt/40 bg-surface-raised relative overflow-hidden rounded-lg border"
>
	<div
		class="bg-gridlines pointer-events-none absolute inset-0 opacity-40"
	></div>

	{#if state === 'armed'}
		<div class="relative flex items-center justify-center gap-6 py-10">
			<span
				class="text-watt glow-text-strong font-display text-7xl leading-none font-bold tabular-nums"
				>{secondsLeft}</span
			>
			<div>
				<p class="font-display text-2xl leading-none font-bold">SPRINT</p>
				<p class="text-muted mt-1 text-xs">
					15 seconds, all out. Targets are off — just go.
				</p>
			</div>
		</div>
	{:else if state === 'active'}
		<div class="relative p-5">
			<div class="flex items-baseline gap-3">
				<span class="font-display text-lg font-bold tracking-wide">SPRINT</span>
				<span
					class="text-watt glow-text-strong font-display ml-auto text-4xl leading-none font-bold tabular-nums"
					>{secondsLeft}</span
				>
			</div>

			<ul class="mt-4 space-y-1.5">
				{#each battle as entry (entry.name)}
					<li class="flex items-center gap-3">
						<span
							class="w-16 shrink-0 truncate text-xs {entry.you
								? 'text-ink'
								: 'text-muted'}">{entry.name}</span
						>
						<div class="bg-surface h-4 flex-1 overflow-hidden rounded">
							<div
								class="h-full rounded transition-[width] duration-200 ease-out {entry.you
									? 'bg-watt glow-stroke'
									: 'bg-neon/70'}"
								style="width: {entry.pct}%"
							></div>
						</div>
						<span
							class="font-display w-14 shrink-0 text-right text-sm font-bold tabular-nums {entry.you
								? 'text-watt'
								: ''}">{entry.wkg.toFixed(1)}</span
						>
						<span class="text-muted w-6 shrink-0 text-[10px]">w/kg</span>
					</li>
				{/each}
			</ul>
		</div>
	{:else if state === 'podium'}
		<div class="relative p-5">
			<p class="text-muted text-[10px] tracking-[0.2em] uppercase">
				sprint podium
			</p>
			<ol class="mt-3 flex items-end gap-3">
				{#each podium as result, i (result.name)}
					<li
						class="flex-1 rounded-lg px-4 {i === 0
							? 'bg-watt/15 py-6'
							: i === 1
								? 'bg-neon/15 py-5'
								: 'bg-surface py-4'}"
					>
						<p class="text-muted text-[10px] tracking-wider uppercase">
							{places[i]}
						</p>
						<p
							class="font-display mt-1 font-bold {i === 0
								? 'text-xl'
								: 'text-base'}"
						>
							{result.name}
						</p>
						<p
							class="font-display mt-1 leading-none font-bold tabular-nums {i ===
							0
								? 'text-watt glow-text text-3xl'
								: 'text-xl'}"
						>
							{result.wkg}<span class="text-muted ml-1 text-xs font-normal"
								>w/kg</span
							>
						</p>
						<p class="text-muted mt-1 font-mono text-[11px] tabular-nums">
							{result.watts} W
						</p>
					</li>
				{/each}
			</ol>
		</div>
	{/if}
</div>
