<script lang="ts">
	import ArrowBigUpDash from '@lucide/svelte/icons/arrow-big-up-dash';
	import { shellUpdate, type ShellUpdate } from '$lib/desktop';

	// The shell's downloaded update, at the top of the sidebar (#1303 followed
	// up). It used to be a panel on home, which is a page a rider in a room
	// never sees — the update sat downloaded for days behind a destination.
	// Here it is the first row of the one navigation, present until it is
	// taken, and gone the rest of the time: nothing renders when no update is
	// waiting, so the row can never be a dead ornament.
	//
	// Chrome, so --color-neon and no glow (ADR-0005): the movement is what
	// makes it read as waiting, not brightness. The sweep is the same idea as
	// .skeleton — something is in flight — slowed to a heartbeat.
	// The bridge is a prop so /dev/components can show the row without a
	// shell around it — in the app nobody passes one.
	let { bridge = shellUpdate() }: { bridge?: ShellUpdate | null } = $props();

	let version = $state('');
	let installing = $state(false);
	// One subscription, taken after mount. onUpdate replays a download that
	// finished before this row existed, so nothing is missed by waiting.
	$effect(() => {
		bridge?.onUpdate((u) => (version = u.version));
	});

	function install() {
		installing = true;
		bridge?.installUpdate();
	}
</script>

{#if version}
	<button
		type="button"
		class="update-row"
		class:installing
		disabled={installing}
		onclick={install}
	>
		<span class="lift"><ArrowBigUpDash size={16} /></span>
		<span class="min-w-0 flex-1 text-left">
			<span class="block truncate text-sm font-semibold">
				{installing ? 'Installing…' : 'Update WattRoom'}
			</span>
			<span class="block truncate text-[11px] opacity-70">
				{installing ? 'reopens by itself' : `${version} is ready`}
			</span>
		</span>
	</button>
{/if}

<style>
	/* One row, the width of the column, the geometry of the rows below it —
	   a card here gets ignored the way Discord's banners do. */
	.update-row {
		--sweep: 3.6s;
		position: relative;
		margin-bottom: 0.5rem;
		display: flex;
		width: 100%;
		align-items: center;
		gap: 0.5rem;
		overflow: hidden;
		border-radius: 0.25rem;
		padding: 0.5rem;
		color: var(--color-ink);
		background: color-mix(in oklab, var(--color-neon) 22%, transparent);
		border: 1px solid color-mix(in oklab, var(--color-neon) 45%, transparent);
		cursor: pointer;
		transition:
			background-color 140ms ease,
			border-color 140ms ease;
	}
	.update-row:hover {
		background: color-mix(in oklab, var(--color-neon) 34%, transparent);
		border-color: color-mix(in oklab, var(--color-neon) 70%, transparent);
	}
	.update-row:disabled {
		cursor: default;
	}

	/* The sweep: one band of light crossing the row, then a rest. Both
	   animations move a transform and nothing else — the first version
	   animated background-position, which re-rasterises the gradient on the
	   main thread every frame and stutters against anything else the sidebar
	   is doing. They share one period so the arrow hops as the band reaches
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
			color-mix(in oklab, var(--color-neon) 60%, transparent),
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

	/* The arrow steps up and lands, which is the whole gesture of the thing. */
	.lift {
		display: flex;
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
	.update-row.installing .lift {
		animation: none;
	}

	@media (prefers-reduced-motion: reduce) {
		.update-row::after,
		.lift {
			animation: none;
		}
	}
</style>
