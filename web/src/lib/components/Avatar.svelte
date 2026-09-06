<script lang="ts">
	import Coffee from '@lucide/svelte/icons/coffee';
	import { presetById } from '$lib/avatars';
	import { levelFromXp, levelProgress } from '$lib/level';
	import RidingBars from '$lib/components/RidingBars.svelte';
	import type { PresenceStatus } from '$lib/status';

	// One avatar everywhere (#253): preset disc → OAuth photo → initial.
	// Presets are neon-outline discs — the accent color at low mix over the
	// raised surface, icon stroked in the token itself — not filled pastels;
	// chrome stays quiet (ADR-0005). With xp set, a violet progress ring
	// wraps the disc and a level chip sits on the rim; chips need ~28px to
	// stay legible, below that the ring alone carries the level.
	//
	// And with `status` set, where they are (#807). The badge lives HERE and
	// not at the call site, which is the whole point: four surfaces had each
	// drawn their own dot in their own corner, and every other surface had
	// none. Bottom-left, because bottom-right is the level chip's.
	let {
		name,
		avatarUrl = null,
		preset = null,
		xp = null,
		status = null,
		size = 40,
		ring = 'var(--color-surface)',
	}: {
		name: string;
		avatarUrl?: string | null;
		preset?: string | null;
		xp?: number | null;
		/** Where they are ($lib/status.ts); null draws no badge at all. */
		status?: PresenceStatus | null;
		size?: number;
		/** What the badge punches its hole in — the surface behind the face. */
		ring?: string;
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
	// A dot is a dot; a mark that holds a glyph needs room around it.
	const mark = $derived(Math.max(10, Math.round(size * 0.34)));
	const dot = $derived(Math.max(7, Math.round(size * 0.26)));
	const STATUS_WORD: Record<PresenceStatus, string> = {
		riding: 'riding now',
		online: 'in a room',
		away: 'away',
		offline: 'offline',
	};
	const label = $derived(
		[
			name,
			level === null ? '' : `level ${level}`,
			status ? STATUS_WORD[status] : '',
		]
			.filter(Boolean)
			.join(' · '),
	);
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
	title={label}
>
	<span
		class="absolute flex items-center justify-center overflow-hidden rounded-full {status ===
		'offline'
			? 'opacity-50'
			: ''}"
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
	{#if status === 'riding' || status === 'away'}
		<!-- Riding is motion, never a dot (ADR-0020); away is the Lounge
		     button's own glyph, quiet chrome like every other mark. -->
		<span
			class="absolute -bottom-0.5 -left-0.5 grid place-items-center rounded-full"
			style="width:{mark}px;height:{mark}px;background:{ring};box-shadow:0 0 0 2px {ring}"
			aria-label={STATUS_WORD[status]}
		>
			{#if status === 'riding'}
				<RidingBars size={Math.round(mark * 0.6)} />
			{:else}
				<Coffee size={Math.round(mark * 0.7)} class="text-muted" />
			{/if}
		</span>
	{:else if status}
		<span
			class="absolute -bottom-0.5 -left-0.5 rounded-full"
			style="width:{dot}px;height:{dot}px;box-shadow:0 0 0 2px {ring};background:{status ===
			'online'
				? 'var(--color-z4)'
				: 'color-mix(in oklab, var(--color-muted) 45%, transparent)'}"
			aria-label={STATUS_WORD[status]}
		></span>
	{/if}
</span>
