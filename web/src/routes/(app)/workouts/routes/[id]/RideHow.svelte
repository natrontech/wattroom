<script lang="ts">
	import Bike from '@lucide/svelte/icons/bike';
	import type { Component } from 'svelte';
	import { formatKm } from '$lib/format';
	import { classedOf, type Climb } from '$lib/road/climbs';

	/**
	 * How to ride a route, beside its road (#3680): one row per way to ride,
	 * which stretch of it, and the one primary. A way is a row only once its
	 * flow works — Workout on it (#3681) and Plan it for a crew (#3682) add
	 * theirs to WAYS — so nothing here is a disabled promise. On a phone the
	 * primary comes first; on a desk it closes the column.
	 */
	let {
		id,
		length,
		climbs,
		carry,
	}: {
		id: string;
		length: number;
		climbs: Climb[];
		/** Where the owner's last ride alone stopped short, or null. */
		carry: number | null;
	} = $props();

	type Way = {
		key: string;
		icon: Component;
		label: string;
		line: string;
		href: (fromM: number) => string;
	};
	const WAYS: Way[] = [
		{
			key: 'ride',
			icon: Bike,
			label: 'Ride it',
			line: 'The road’s own grade, SIM',
			href: (fromM) =>
				`/ride?road=${encodeURIComponent(id)}${fromM > 0 ? `&from=${Math.round(fromM)}` : ''}`,
		},
	];
	let way = $state('ride');
	const chosen = $derived(WAYS.find((w) => w.key === way) ?? WAYS[0]);

	const classed = $derived(classedOf(climbs));
	let stretch = $state<'whole' | 'carry' | 'climb'>('whole');
	let climbAt = $state(0);
	const climb = $derived(classed[Math.min(climbAt, classed.length - 1)]);
	const fromM = $derived(
		stretch === 'carry' && carry !== null
			? carry
			: stretch === 'climb' && climb
				? climb.startM
				: 0,
	);
	const said = $derived(
		stretch === 'carry' && carry !== null
			? `From km ${formatKm(carry)} to the end, where you left off.`
			: stretch === 'climb' && climb
				? `From the foot of Climb ${classed.indexOf(climb) + 1} at km ${formatKm(climb.startM)}; its top is at km ${formatKm(climb.topM)}.`
				: `All ${formatKm(length)} km, from the start.`,
	);
	const chip = (on: boolean) =>
		`btn btn-xs rounded-full border ${on ? 'border-neon text-ink' : 'border-muted/30 hover:border-muted/60'}`;
</script>

<div class="flex flex-col gap-4">
	<div>
		<p class="eyebrow">How</p>
		<div class="mt-2 grid gap-2" role="group" aria-label="how to ride it">
			{#each WAYS as w (w.key)}
				<button
					type="button"
					onclick={() => (way = w.key)}
					aria-pressed={way === w.key}
					class="flex w-full items-start gap-3 rounded-lg border px-3 py-2 text-left {way ===
					w.key
						? 'border-neon'
						: 'border-frame hover:border-muted/60'}"
				>
					<w.icon size={16} class="text-muted mt-1 shrink-0" />
					<span class="min-w-0">
						<span class="text-ink block text-sm font-semibold">{w.label}</span>
						<span class="text-muted block text-xs">{w.line}</span>
					</span>
				</button>
			{/each}
		</div>
	</div>

	<div>
		<p class="eyebrow">Which stretch</p>
		<div
			class="mt-2 flex flex-wrap gap-2"
			role="group"
			aria-label="which stretch"
		>
			<button
				onclick={() => (stretch = 'whole')}
				aria-pressed={stretch === 'whole'}
				class={chip(stretch === 'whole')}>Whole road</button
			>
			{#if carry !== null}
				<button
					onclick={() => (stretch = 'carry')}
					aria-pressed={stretch === 'carry'}
					class={chip(stretch === 'carry')}>From km {formatKm(carry)}</button
				>
			{/if}
			{#if classed.length > 0}
				<button
					onclick={() => (stretch = 'climb')}
					aria-pressed={stretch === 'climb'}
					class={chip(stretch === 'climb')}>One climb</button
				>
			{/if}
		</div>
		{#if stretch === 'climb' && classed.length > 1}
			<div
				class="mt-2 flex flex-wrap gap-2"
				role="group"
				aria-label="which climb"
			>
				{#each classed as c, i (c.startM)}
					<button
						onclick={() => (climbAt = i)}
						aria-pressed={climb === c}
						class={chip(climb === c)}>Climb {i + 1} · {c.cls}</button
					>
				{/each}
			</div>
		{/if}
		<p class="text-muted mt-2 text-xs">{said}</p>
	</div>

	<a
		href={chosen.href(fromM)}
		class="btn btn-primary btn-lg order-first w-full lg:order-none"
		>{chosen.label}</a
	>
</div>
