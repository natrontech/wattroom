<script lang="ts">
	// The one update row, at the foot of the sidebar (#2588). It was two
	// panels on Home — a page nobody opens first since WattRoom starts in your
	// crew (#2576) — and a row at the top of this column (#1303). At the top it
	// "moves things around": a row that comes and goes above the navigation
	// shifts every row under it. Down here it sits above you and moves nothing.
	// It says one thing (update-row.ts) and does that one thing on click.
	//
	// Chrome, so --color-neon and no glow (ADR-0005): the movement is what
	// makes it read as waiting, not brightness. The sweep is the same idea as
	// .skeleton — something is in flight — slowed to a heartbeat.
	import ArrowBigUpDash from '@lucide/svelte/icons/arrow-big-up-dash';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import Download from '@lucide/svelte/icons/download';
	import LoaderCircle from '@lucide/svelte/icons/loader-circle';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';
	import Sparkles from '@lucide/svelte/icons/sparkles';
	import X from '@lucide/svelte/icons/x';
	import type { Icon } from '$lib/icons';
	import type { UpdateRowState } from './update-row';

	let {
		state,
		onopen,
		onreload,
		oninstall,
		onskip,
	}: {
		state: UpdateRowState;
		/** A release: open its sheet. */
		onopen: () => void;
		/** A newer WattRoom is live: reload into it. */
		onreload: () => void;
		/** The shell's download: restart into it. */
		oninstall: () => void;
		/** A download by hand, waved away. */
		onskip: () => void;
	} = $props();
</script>

{#snippet face(Glyph: Icon, title: string, sub: string, neutral = false)}
	<span
		class="lift grid size-8 shrink-0 place-items-center rounded-md {neutral
			? 'bg-ink text-paper'
			: 'bg-neon text-on-neon'}"><Glyph size={17} /></span
	>
	<span class="min-w-0 flex-1 text-left">
		<span class="block truncate text-sm leading-tight font-semibold"
			>{title}</span
		>
		<span class="text-muted block truncate text-[11px] leading-snug">{sub}</span
		>
	</span>
{/snippet}

{#if state.kind === 'release'}
	<button type="button" class="update-row" onclick={onopen}>
		{@render face(
			Sparkles,
			'New in WattRoom',
			`${state.version} · ${state.changes} change${state.changes === 1 ? '' : 's'}`,
		)}
		<ChevronRight size={14} class="text-muted shrink-0" />
	</button>
{:else if state.kind === 'live'}
	<button type="button" class="update-row" onclick={onreload}>
		{@render face(RefreshCw, `${state.version} is live`, 'Reload to get it')}
		<span class="text-ink shrink-0 text-[11px] font-semibold">Reload</span>
	</button>
{:else if state.kind === 'desktop'}
	<button type="button" class="update-row" onclick={oninstall}>
		{@render face(
			ArrowBigUpDash,
			'Update the app',
			`${state.version} is ready · restarts`,
		)}
	</button>
{:else if state.kind === 'manual'}
	<!-- Two targets, side by side rather than nested: the download is a
	     link, and "not now" is a button a link cannot hold. -->
	<div class="update-row neutral">
		<a href="/download" class="flex min-w-0 flex-1 items-center gap-2.5">
			{@render face(
				Download,
				`Get app ${state.version}`,
				'It could not update itself',
				true,
			)}
		</a>
		<button
			type="button"
			onclick={onskip}
			class="text-muted hover:text-ink grid size-6 shrink-0 place-items-center rounded"
			title="Not now"
			aria-label="not now"><X size={14} /></button
		>
	</div>
{:else}
	<div class="update-row installing" role="status">
		{@render face(LoaderCircle, 'Installing…', 'Reopens by itself')}
	</div>
{/if}

<style>
	/* One row, the width of the column — a card here gets ignored the way
	   Discord's banners do. */
	.update-row {
		--sweep: 3.6s;
		position: relative;
		display: flex;
		width: 100%;
		align-items: center;
		gap: 0.625rem;
		overflow: hidden;
		border-radius: 0.5rem;
		padding: 0.5rem 0.625rem;
		color: var(--color-ink);
		background: color-mix(in oklab, var(--color-neon) 10%, transparent);
		border: 1px solid color-mix(in oklab, var(--color-neon) 35%, transparent);
		cursor: pointer;
		transition:
			background-color 140ms ease,
			border-color 140ms ease;
	}
	.update-row:hover {
		background: color-mix(in oklab, var(--color-neon) 18%, transparent);
		border-color: color-mix(in oklab, var(--color-neon) 60%, transparent);
	}
	/* A download by hand asks nothing of this window: no sweep, no tint. */
	.update-row.neutral {
		cursor: default;
		background: var(--color-surface-raised);
		border-color: color-mix(in oklab, var(--color-ink) 14%, transparent);
	}
	.update-row.neutral::after {
		display: none;
	}
	.update-row.installing {
		cursor: default;
	}
	/* The sweep: one band of light crossing the row, then a rest. Both
	   animations move a transform and nothing else — the first version
	   animated background-position, which re-rasterises the gradient on the
	   main thread every frame and stutters against anything else the sidebar
	   is doing. They share one period so the icon hops as the band reaches
	   it, rather than the two drifting in and out of phase. */
	.update-row::after {
		content: '';
		position: absolute;
		top: 0;
		bottom: 0;
		left: 0;
		width: 40%;
		background: linear-gradient(
			90deg,
			transparent,
			color-mix(in oklab, var(--color-neon) 35%, transparent),
			transparent
		);
		/* Starts and ends off both edges, so the loop has no visible seam and
		   needs no easing to hide one. */
		animation: sweep var(--sweep) linear infinite;
		will-change: transform;
		pointer-events: none;
	}
	@keyframes sweep {
		0% {
			transform: translateX(-100%);
		}
		30% {
			transform: translateX(250%);
		}
		100% {
			transform: translateX(250%);
		}
	}
	/* Installing: no rest. The band runs the whole period, because it is the
	   last thing the rider sees before the window goes. */
	.update-row.installing {
		--sweep: 1.1s;
	}
	.update-row.installing::after {
		animation-name: sweep-run;
	}
	@keyframes sweep-run {
		from {
			transform: translateX(-100%);
		}
		to {
			transform: translateX(250%);
		}
	}

	/* The icon steps up and lands, which is the whole gesture of the thing. */
	.update-row :global(.lift) {
		animation: lift var(--sweep) ease-out infinite;
	}
	@keyframes lift {
		0%,
		14%,
		100% {
			transform: translateY(0);
		}
		7% {
			transform: translateY(-3px);
		}
	}
	.update-row.installing :global(.lift),
	.update-row.neutral :global(.lift) {
		animation: none;
	}
	.update-row.installing :global(.lift svg) {
		animation: spin 1.1s linear infinite;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.update-row::after,
		.update-row :global(.lift),
		.update-row.installing :global(.lift svg) {
			animation: none;
		}
	}
</style>
