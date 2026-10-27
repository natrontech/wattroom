<script lang="ts">
	/**
	 * This phone as the remote for the rider's other screen (#3217, ADR-0025):
	 * a 2×4 grid of 64 px buttons, thumb-sized for a rider on a bike (ux.md).
	 * Every press is a closed-set RemoteCommand the holding tab runs through its
	 * keymap. Easier and Harder tap and never hold: a lost release measured up
	 * to 5 phantom shifts. Only Talk holds, with a beat (remote-talk.ts).
	 *
	 * Chrome, not live data: neon, never the watt accent (ADR-0005).
	 */
	import { onDestroy, onMount } from 'svelte';
	import type { createChannelLive } from '$lib/channel/live.svelte';
	import { gearsEnabled } from '$lib/ride/gears-enabled';
	import { createTalkHold } from '$lib/ride/remote-talk';
	import { keepAwakeWhile } from '$lib/workout/keep-awake.svelte';
	import { PAGE_NAMES, type ComputerPage } from '$lib/session/computer-pages';

	let {
		live,
		onclose,
	}: {
		live: ReturnType<typeof createChannelLive>;
		onclose: () => void;
	} = $props();

	// The actions the holding tab runs today; the others say so, disabled.
	// Page, Map and 3D / Flat turn the riding screen's own controls (#4223).
	const RUNS = new Set(['talk', 'easier', 'harder', 'page', 'map', 'view']);
	const CELLS = [
		{ action: 'page', label: 'Page' },
		{ action: 'map', label: 'Map' },
		{ action: 'view', label: '3D / Flat' },
		{ action: 'camera', label: 'Camera' },
		{ action: 'photo', label: 'Photo' },
		{ action: 'cheer-back', label: 'Cheer back' },
	];
	// What the riding screen shows now, as it last said: the answer to Page,
	// Map and 3D / Flat with no screen to look at.
	const shown = $derived(
		live.view
			? `${PAGE_NAMES[live.view.page as ComputerPage] ?? live.view.page.toUpperCase()} · ${live.view.world ? '3D' : 'Flat'}`
			: null,
	);
	const geared = gearsEnabled('phone');
	const talk = createTalkHold((action) => live.sendRemote(action));
	onDestroy(talk.up);
	// A phone that opens late asks the holder where it is: its gear and
	// whether the ride is a solo one it may pause.
	onMount(() => live.sendRemote('sync'));
	// A remote that sleeps mid-ride is a phone to unlock with sweaty hands (#4219).
	keepAwakeWhile(() => true);

	const cell =
		'btn btn-accent btn-ride min-h-16 text-2xl! disabled:cursor-not-allowed disabled:opacity-60';
</script>

<div
	class="bg-surface safe-p-4 fixed inset-0 z-50 flex flex-col gap-3 overflow-y-auto"
	role="dialog"
	aria-label="Phone remote"
	data-testid="phone-remote"
>
	<div class="flex items-center justify-between">
		<h2 class="text-2xl font-semibold">Remote</h2>
		<button
			type="button"
			class="btn btn-accent btn-ride text-2xl!"
			onclick={onclose}
		>
			Done
		</button>
	</div>

	<div class="grid flex-1 auto-rows-fr grid-cols-2 gap-3">
		{#each CELLS as c (c.action)}
			<button
				type="button"
				class={cell}
				disabled={!RUNS.has(c.action)}
				onclick={() => live.sendRemote(c.action)}
			>
				{c.label}
			</button>
		{/each}
		<button
			type="button"
			class={cell}
			style="touch-action: none"
			onpointerdown={talk.down}
			onpointerup={talk.up}
			onpointerleave={talk.up}
			onpointercancel={talk.up}
			oncontextmenu={(event) => event.preventDefault()}
		>
			Talk
		</button>
		{#if !geared}
			<button
				type="button"
				class={cell}
				onclick={() => live.sendRemote('easier')}
			>
				Bias −
			</button>
			<button
				type="button"
				class={cell}
				onclick={() => live.sendRemote('harder')}
			>
				Bias +
			</button>
		{/if}
	</div>

	{#if shown}
		<p
			class="text-neon text-center text-2xl"
			aria-live="polite"
			data-testid="remote-view"
		>
			{shown}
		</p>
	{/if}

	{#if geared}
		<div class="grid flex-1 auto-rows-fr grid-cols-2 gap-3">
			<button
				type="button"
				class={cell}
				onclick={() => live.sendRemote('easier')}
			>
				Easier
			</button>
			<button
				type="button"
				class={cell}
				onclick={() => live.sendRemote('harder')}
			>
				Harder
			</button>
		</div>
		{#if live.gear}
			<p
				class="text-neon text-center text-2xl"
				aria-live="polite"
				data-testid="remote-gear"
			>
				{live.gear.label}{live.gear.atEnd ? ' · end' : ''}
			</p>
		{/if}
	{/if}

	{#if live.pause?.pausable}
		<div class="grid grid-cols-2 gap-3">
			<button
				type="button"
				class={cell}
				disabled={live.pause.paused}
				onclick={() => live.sendRemote('pause')}
			>
				Pause
			</button>
			<button
				type="button"
				class={cell}
				disabled={!live.pause.paused}
				onclick={() => live.sendRemote('resume')}
			>
				Resume
			</button>
		</div>
		{#if live.pause.paused}
			<p class="text-neon text-center text-2xl" aria-live="polite">Paused</p>
		{/if}
	{/if}

	{#if live.remoteRefusal}
		<p class="text-danger text-2xl leading-7" role="alert">
			{live.remoteRefusal}
		</p>
	{:else if CELLS.some((c) => !RUNS.has(c.action))}
		<p class="text-ink-muted text-2xl leading-7">
			Dimmed: on the riding screen only.
		</p>
	{/if}
</div>
