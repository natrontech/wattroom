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
	import { CAMERA_NAMES, type CameraPreset } from '$lib/world/cameras';

	let {
		live,
		onclose,
	}: {
		live: ReturnType<typeof createChannelLive>;
		onclose: () => void;
	} = $props();

	// Page, Map and 3D / Flat turn the riding screen's own controls (#4223);
	// Camera and Photo its world, so they wait for 3D; Cheer answers the
	// rider who last cheered you, or cheers everyone (#4253).
	const CELLS = [
		{ action: 'page', label: 'Page' },
		{ action: 'map', label: 'Map' },
		{ action: 'view', label: '3D / Flat' },
		{ action: 'camera', label: 'Camera', world: true },
		{ action: 'photo', label: 'Photo', world: true },
		{ action: 'cheer-back', label: 'Cheer' },
	];
	const world = $derived(!!live.view?.world);
	// What the riding screen shows now, as it last said: the answer to Page,
	// Map, 3D / Flat and Camera with no screen to look at.
	const shown = $derived(
		live.view
			? [
					PAGE_NAMES[live.view.page as ComputerPage] ??
						live.view.page.toUpperCase(),
					live.view.world ? '3D' : 'Flat',
					live.view.camera
						? (CAMERA_NAMES[live.view.camera as CameraPreset] ?? '')
						: '',
				]
					.filter(Boolean)
					.join(' · ')
			: null,
	);
	// Photo's answer: the riding screen's count of pictures rose past the
	// one it had when the button was pressed.
	let photoFrom = $state<number | null>(null);
	const pictureTaken = $derived(
		photoFrom !== null && (live.view?.pictures ?? 0) > photoFrom,
	);
	function press(action: string) {
		if (action === 'photo') photoFrom = live.view?.pictures ?? 0;
		live.sendRemote(action);
	}
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
				disabled={c.world && !world}
				onclick={() => press(c.action)}
			>
				{c.label}
			</button>
		{/each}
		<button
			type="button"
			class="{cell} col-span-2"
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
			{pictureTaken ? 'Picture taken' : shown}
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
	{:else if !world}
		<p class="text-ink-muted text-2xl leading-7" data-testid="remote-hint">
			Camera and Photo need the 3D view.
		</p>
	{/if}
</div>
