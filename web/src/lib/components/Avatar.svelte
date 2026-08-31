<script lang="ts">
	import { presetById } from '$lib/avatars';
	import { levelFromXp, levelProgress } from '$lib/level';

	// One avatar everywhere (#253): preset disc → OAuth photo → initial.
	// Presets are neon-outline discs — the accent color at low mix over the
	// raised surface, icon stroked in the token itself — not filled pastels;
	// chrome stays quiet (ADR-0005). With xp set, a violet progress ring
	// wraps the disc and a level chip sits on the rim; chips need ~28px to
	// stay legible, below that the ring alone carries the level.
	let {
		name,
		avatarUrl = null,
		preset = null,
		xp = null,
		size = 40,
	}: {
		name: string;
		avatarUrl?: string | null;
		preset?: string | null;
		xp?: number | null;
		size?: number;
	} = $props();

	const chosen = $derived(preset ? presetById(preset) : undefined);
	const level = $derived(xp == null ? null : levelFromXp(xp));
	const stroke = $derived(Math.max(2, Math.round(size / 20)));
	const radius = $derived((size - stroke) / 2);
	const circumference = $derived(2 * Math.PI * radius);
	const dash = $derived(circumference * (xp == null ? 0 : levelProgress(xp)));
	const inset = $derived(xp == null ? 0 : stroke + 2);
	const chip = $derived(Math.max(14, Math.round(size * 0.26)));
	const showChip = $derived(level !== null && size >= 28);
	const disc = $derived(
		chosen
			? `background:color-mix(in oklab, ${chosen.bg} 16%, var(--color-surface-raised));` +
					`border:1px solid color-mix(in oklab, ${chosen.bg} 55%, transparent);color:${chosen.bg}`
			: `background:var(--color-surface-raised);` +
					`border:1px solid color-mix(in oklab, var(--color-muted) 30%, transparent);color:var(--color-muted)`,
	);
</script>

<span
	class="relative inline-block shrink-0 align-middle"
	style="width:{size}px;height:{size}px"
	title={level === null ? name : `${name} · level ${level}`}
>
	<span
		class="absolute flex items-center justify-center overflow-hidden rounded-full"
		style="inset:{inset}px;{avatarUrl && !chosen ? '' : disc}"
	>
		{#if chosen}
			{@const Icon = chosen.icon}
			<Icon size={Math.round((size - inset * 2) * 0.52)} />
		{:else if avatarUrl}
			<img
				src={avatarUrl}
				alt={name}
				referrerpolicy="no-referrer"
				class="h-full w-full object-cover"
			/>
		{:else}
			<span
				class="font-display font-bold select-none"
				style="font-size:{Math.round(size * 0.38)}px"
				>{name.charAt(0).toUpperCase()}</span
			>
		{/if}
	</span>
	{#if xp != null}
		<svg
			viewBox="0 0 {size} {size}"
			class="absolute inset-0 -rotate-90"
			aria-hidden="true"
		>
			<circle
				cx={size / 2}
				cy={size / 2}
				r={radius}
				fill="none"
				stroke="color-mix(in oklab, var(--color-muted) 22%, transparent)"
				stroke-width={stroke}
			/>
			{#if dash > 0}
				<circle
					cx={size / 2}
					cy={size / 2}
					r={radius}
					fill="none"
					stroke="var(--color-neon)"
					stroke-width={stroke}
					stroke-linecap="round"
					stroke-dasharray="{dash} {circumference}"
				/>
			{/if}
		</svg>
	{/if}
	{#if showChip}
		<span
			class="font-display absolute -right-0.5 -bottom-0.5 flex items-center justify-center rounded-full font-bold text-white tabular-nums"
			style="background:var(--color-neon);border:2px solid var(--color-surface);min-width:{chip}px;height:{chip}px;font-size:{Math.round(
				chip * 0.52,
			)}px;padding:0 3px">{level}</span
		>
	{/if}
</span>
