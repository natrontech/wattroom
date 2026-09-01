<script module lang="ts">
	export type TargetVariant = 'notch' | 'delta';
</script>

<script lang="ts">
	import {
		CEILING,
		fillPct,
		targetState,
		type MockRider,
	} from '$lib/room/mockcompat';

	let {
		you,
		variant,
		compact = false,
	}: { you: MockRider; variant: TargetVariant; compact?: boolean } = $props();

	const state = $derived(targetState(you));
	const pct = (watts: number) => fillPct(watts, you.ftp);
</script>

{#if variant === 'notch'}
	<div
		class="bg-surface-raised ring-ink/10 flex h-24 items-center gap-6 rounded-lg px-5 ring-1"
	>
		<div class="shrink-0">
			<span
				class="text-watt glow-text-strong font-display text-5xl leading-none font-bold tabular-nums"
				>{you.watts}</span
			>
			<span class="text-muted ml-1 text-sm">W</span>
		</div>
		<div class="flex-1">
			<div class="bg-surface relative h-8 overflow-hidden rounded">
				{#if state.has}
					<!-- Tolerance band sits behind the fill: you see the slot you're aiming at. -->
					<div
						class="bg-neon/35 absolute inset-y-0"
						style="left: {pct(you.target - state.band)}%; width: {pct(
							you.target + state.band,
						) - pct(you.target - state.band)}%"
					></div>
				{/if}
				<div
					class="bg-watt/70 absolute inset-y-0 left-0 transition-[width] duration-500 ease-out"
					style="width: {pct(you.watts)}%"
				></div>
				{#if state.has}
					<div
						class="bg-neon absolute inset-y-0 w-0.5"
						style="left: {pct(you.target)}%"
					></div>
				{/if}
			</div>
			{#if !compact}
				<div
					class="text-muted mt-1.5 flex justify-between font-mono text-[10px]"
				>
					<span>0</span>
					<span>{state.has ? `target ${you.target} W` : 'no target'}</span>
					<span>{Math.round(you.ftp * CEILING)}</span>
				</div>
			{/if}
		</div>
		{#if compact}
			<span class="text-muted shrink-0 font-mono text-[11px] tabular-nums"
				>{state.has ? `${you.target} W` : '—'}</span
			>
		{/if}
	</div>
{:else}
	<div class="flex items-baseline gap-[2vw]">
		<div>
			<span
				class="text-watt glow-text-strong font-display text-[15vh] leading-none font-bold tabular-nums"
				>{you.watts}</span
			>
			<span class="text-muted ml-2 text-[3vh]">W</span>
		</div>
		<div
			class="font-display rounded-lg px-[1.5vw] py-[0.6vh] text-[6vh] leading-none font-bold tabular-nums {state.inBand
				? 'bg-z4/15 text-z4'
				: 'bg-danger/15 text-danger'}"
		>
			{state.has ? `${state.delta > 0 ? '+' : ''}${state.delta}` : '—'}
		</div>
	</div>
{/if}
