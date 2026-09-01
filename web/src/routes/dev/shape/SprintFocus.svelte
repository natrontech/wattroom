<script lang="ts">
	// The sprint moment, in the focus slot (#390, ADR-0020).
	//
	// WATTROOM.md calls this "the one place the UI is allowed to go loud", and
	// today it is a small card appended under the dashboard — the quietest
	// element on screen for the loudest fifteen seconds in the product. In the
	// focus slot it takes the screen and gives it back, which is what the slot
	// is for.
	//
	// A sprint is a CONTEST, so the crew stops being context and becomes the
	// scoreboard: ranked live on w/kg, which is the fair ordering for mixed
	// groups (docs/SPEC.md — same rule as every contest in the app).
	import RidingBars from './RidingBars.svelte';
	import { wkg } from '$lib/format';
	import type { RoomRider } from '$lib/room/view';

	let {
		riders,
		phase,
	}: {
		riders: RoomRider[];
		/** docs/SPEC.md: 3 s klaxon, 15 s window, then the podium. */
		phase: 'klaxon' | 'live' | 'podium';
	} = $props();

	const you = $derived(riders.find((r) => r.you)!);
	const ranked = $derived(
		[...riders].sort((a, b) => b.watts / b.kg - a.watts / a.kg),
	);
	const best = $derived(ranked[0]);
</script>

{#if phase === 'klaxon'}
	<!-- Three seconds of nothing else. The rider is about to be asked for
	     everything they have; the screen should not be showing them a graph. -->
	<div class="grid h-full place-items-center">
		<div class="text-center">
			<p class="eyebrow">get ready</p>
			<p
				class="font-display text-watt glow-text-strong text-[12rem] leading-none font-bold tabular-nums"
			>
				3
			</p>
			<p class="font-display mt-2 text-3xl font-bold">SPRINT</p>
			<p class="text-muted mt-1 text-sm">
				15 seconds, all out — your trainer lets go of the target
			</p>
		</div>
	</div>
{:else if phase === 'live'}
	<div class="grid h-full min-h-0 grid-rows-[auto_1fr] gap-4">
		<div class="flex items-end gap-6">
			<div>
				<p class="eyebrow">all out</p>
				<p
					class="font-display text-watt glow-text-strong text-8xl leading-none font-bold tabular-nums"
				>
					{you.watts}
				</p>
			</div>
			<div class="pb-2">
				<p class="eyebrow">w/kg</p>
				<p class="font-display text-4xl leading-none font-bold tabular-nums">
					{wkg(you.watts, you.kg)}
				</p>
			</div>
			<div class="ml-auto pb-2 text-right">
				<p class="eyebrow">left</p>
				<p class="font-display text-5xl leading-none font-bold tabular-nums">
					8.4
				</p>
			</div>
		</div>

		<!-- Live standings. Ranked on w/kg, not watts: a 62 kg climber and a
		     78 kg sprinter are not racing the same number. -->
		<ol class="min-h-0 space-y-1.5 overflow-hidden">
			{#each ranked as rider, i (rider.id)}
				<li
					class="flex items-center gap-3 rounded px-3 py-2 {rider.you
						? 'bg-surface-raised'
						: ''}"
				>
					<span
						class="font-display text-muted w-6 shrink-0 text-lg font-bold tabular-nums"
						>{i + 1}</span
					>
					<span
						class="min-w-0 flex-1 truncate text-sm {rider.you
							? 'font-semibold'
							: ''}">{rider.name}</span
					>
					<!-- The bar is the race: everyone against the current leader. -->
					<span
						class="bg-surface h-2 w-40 shrink-0 overflow-hidden rounded-full"
					>
						<span
							class="bg-watt block h-full transition-[width] duration-300"
							style="width: {Math.min(
								100,
								(rider.watts / rider.kg / Math.max(0.1, best.watts / best.kg)) *
									100,
							)}%"
						></span>
					</span>
					<span
						class="font-display w-16 shrink-0 text-right text-lg font-bold tabular-nums {i ===
						0
							? 'text-watt glow-text'
							: ''}">{wkg(rider.watts, rider.kg)}</span
					>
					<span class="text-muted w-14 shrink-0 text-right text-xs tabular-nums"
						>{rider.watts} W</span
					>
				</li>
			{/each}
		</ol>
	</div>
{:else}
	<div class="grid h-full place-items-center">
		<div class="w-full max-w-lg text-center">
			<p class="eyebrow">sprint podium</p>
			<ol class="mt-4 space-y-2">
				{#each ranked.slice(0, 3) as rider, i (rider.id)}
					<li
						class="flex items-center gap-3 rounded-lg px-4 py-3 {i === 0
							? 'border-watt/40 border-2'
							: 'bg-surface-raised'}"
					>
						<span class="shrink-0 text-2xl">{['🥇', '🥈', '🥉'][i]}</span>
						<span class="flex-1 truncate text-left font-medium"
							>{rider.name}</span
						>
						<span
							class="font-display text-2xl font-bold tabular-nums {i === 0
								? 'text-watt glow-text-strong'
								: ''}">{wkg(rider.watts, rider.kg)}</span
						>
						<span class="text-muted text-xs">w/kg</span>
					</li>
				{/each}
			</ol>
			<p class="text-muted mt-4 flex items-center justify-center gap-2 text-xs">
				<RidingBars size={9} /> back to the workout — targets return in 3s
			</p>
		</div>
	</div>
{/if}
