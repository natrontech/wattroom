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

	/* The sweep: a band of light crossing the row every four seconds, and
	   every second once the install is running — the only thing that can
	   report progress from a process that is about to die. */
	.update-row::after {
		content: '';
		position: absolute;
		inset: 0;
		background: linear-gradient(
			100deg,
			transparent 35%,
			color-mix(in oklab, var(--color-neon) 55%, transparent) 50%,
			transparent 65%
		);
		background-size: 250% 100%;
		animation: sweep 4s ease-in-out infinite;
		pointer-events: none;
	}
	.update-row.installing::after {
		animation-duration: 1s;
		animation-timing-function: linear;
	}
	@keyframes sweep {
		from {
			background-position: 200% 0;
		}
		to {
			background-position: -100% 0;
		}
	}

	/* The arrow steps up and lands, which is the whole gesture of the thing. */
	.lift {
		display: flex;
		animation: lift 2.4s cubic-bezier(0.34, 1.56, 0.64, 1) infinite;
	}
	@keyframes lift {
		0%,
		55%,
		100% {
			transform: translateY(0);
		}
		30% {
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
