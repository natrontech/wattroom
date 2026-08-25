<script module lang="ts">
	export type TargetVariant = 'band' | 'notch' | 'delta';
	export const TARGET_VARIANTS: { id: TargetVariant; label: string }[] = [
		{ id: 'band', label: 'Corridor' },
		{ id: 'notch', label: 'Notch bar' },
		{ id: 'delta', label: 'Delta' },
	];
</script>

<script lang="ts">
	import { bandWatts, type MockRider } from './mockRoom.svelte';

	let { you, variant }: { you: MockRider; variant: TargetVariant } = $props();

	const has = $derived(you.target > 0);
	const band = $derived(has ? bandWatts(you.target) : 0);
	const delta = $derived(you.watts - you.target);
	const inBand = $derived(has && Math.abs(delta) <= band);

	/** Corridor: ±25 % FTP off target spans the height. */
	const SPAN = 0.25;
	const offset = $derived(
		has
			? 50 - (Math.max(-SPAN, Math.min(SPAN, delta / you.ftp)) / SPAN) * 46
			: 50,
	);
	const bandPct = $derived(has ? (band / you.ftp / SPAN) * 46 : 0);

	/** Notch bar: the whole bar spans 0 → 150 % FTP, target marked in place. */
	const pct = (watts: number) => Math.min(100, (watts / you.ftp / 1.5) * 100);
</script>

{#if variant === 'band'}
	<div
		class="bg-surface-raised relative h-24 overflow-hidden rounded-lg ring-1 ring-white/10"
	>
		<div class="bg-gridlines absolute inset-0 opacity-25"></div>
		<div
			class="absolute inset-x-0 transition-opacity duration-300"
			style="top: {50 - bandPct}%; height: {bandPct * 2}%;
				background: linear-gradient(to bottom, transparent, color-mix(in oklab, var(--color-neon) 26%, transparent), transparent);
				opacity: {inBand ? 0.55 : 1}"
		></div>
		<div
			class="bg-neon absolute inset-x-0 top-1/2 h-px"
			style="box-shadow: 0 0 10px color-mix(in oklab, var(--color-neon) 45%, transparent)"
		></div>
		<div
			class="absolute right-4 flex -translate-y-1/2 items-center gap-3 transition-[top] duration-700 ease-out"
			style="top: {offset}%"
		>
			<div class="text-watt glow-stroke h-1 w-16 rounded-full bg-current"></div>
			<span
				class="text-watt glow-text-strong font-display text-5xl leading-none font-bold tabular-nums"
				>{you.watts}</span
			>
		</div>
		<span
			class="text-muted absolute top-1/2 left-4 -translate-y-1/2 text-[10px] tracking-wider uppercase"
			>{has ? `target ${you.target} W` : 'no target'}</span
		>
	</div>
{:else if variant === 'notch'}
	<div
		class="bg-surface-raised flex h-24 items-center gap-6 rounded-lg px-5 ring-1 ring-white/10"
	>
		<div class="shrink-0">
			<span
				class="text-watt glow-text-strong font-display text-5xl leading-none font-bold tabular-nums"
				>{you.watts}</span
			>
			<span class="text-muted ml-1 text-sm">W</span>
		</div>
		<div class="relative flex-1">
			<div class="bg-surface relative h-8 overflow-hidden rounded">
				{#if has}
					<!-- Tolerance band sits behind the fill, so you see the slot you're aiming at. -->
					<div
						class="bg-neon/35 absolute inset-y-0"
						style="left: {pct(you.target - band)}%; width: {pct(
							you.target + band,
						) - pct(you.target - band)}%"
					></div>
				{/if}
				<div
					class="bg-watt/70 absolute inset-y-0 left-0 transition-[width] duration-500 ease-out"
					style="width: {pct(you.watts)}%"
				></div>
				{#if has}
					<div
						class="bg-neon absolute inset-y-0 w-0.5"
						style="left: {pct(you.target)}%"
					></div>
				{/if}
			</div>
			<div class="text-muted mt-1.5 flex justify-between font-mono text-[10px]">
				<span>0</span>
				<span>{has ? `target ${you.target} W` : 'no target'}</span>
				<span>{Math.round(you.ftp * 1.5)}</span>
			</div>
		</div>
	</div>
{:else}
	<div
		class="bg-surface-raised flex h-24 items-center gap-8 rounded-lg px-6 ring-1 ring-white/10"
	>
		<div>
			<span
				class="text-watt glow-text-strong font-display text-6xl leading-none font-bold tabular-nums"
				>{you.watts}</span
			>
			<span class="text-muted ml-1 text-sm">W</span>
		</div>
		<div
			class="font-display rounded px-3 py-1.5 text-2xl font-bold tabular-nums {inBand
				? 'bg-z4/15 text-z4'
				: 'bg-z6/15 text-z6'}"
		>
			{has ? `${delta > 0 ? '+' : ''}${delta}` : '—'}
		</div>
		<div class="text-muted text-xs">
			<div class="font-mono tabular-nums">
				{has ? `${you.target} W` : 'no target'}
			</div>
			<div class="text-[10px] tracking-wider uppercase">target</div>
		</div>
	</div>
{/if}
