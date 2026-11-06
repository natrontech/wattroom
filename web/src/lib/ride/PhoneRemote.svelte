<script lang="ts">
	/**
	 * This phone as the remote for the rider's other screen (#3217, ADR-0025):
	 * two columns of 64 px buttons, thumb-sized for a rider on a bike (ux.md).
	 * Every press is a closed-set RemoteCommand the holding tab runs through its
	 * keymap. Easier and Harder tap and never hold: a lost release measured up
	 * to 5 phantom shifts. Only Talk holds, with a beat (remote-talk.ts).
	 *
	 * Chrome, not live data: neon, never the watt accent (ADR-0005).
	 *
	 * `link` is the way to the riding screen: a voice channel's socket, or the
	 * rider's own lane for a ride alone (#4425). Talk and Cheer reach a call
	 * and a channel, so a ride alone draws neither (`social`).
	 */
	import { onDestroy, onMount } from 'svelte';
	import type { RemoteLink } from '$lib/ride/remote-link';
	import { LAST_BLOCK, NO_BLOCKS } from '$lib/ride/remote-blocks';
	import { gearsEnabled } from '$lib/ride/gears-enabled';
	import { createTalkHold } from '$lib/ride/remote-talk';
	import { keepAwakeWhile } from '$lib/workout/keep-awake.svelte';
	import { answerLine, remoteLine } from '$lib/ride/remote-line';

	let {
		link: live,
		social = true,
		onclose,
	}: {
		link: RemoteLink;
		/** The ride is in a voice channel: Talk and Cheer have somewhere to go. */
		social?: boolean;
		onclose: () => void;
	} = $props();

	// Page, Map and 3D / Flat turn the riding screen's own controls (#4223);
	// Cheer answers the rider who last cheered you, or cheers everyone; Camera
	// and Photo turn its world, so they wait for 3D, one row under Talk with
	// the line that says so (#4253).
	const CELLS = $derived([
		{ action: 'page', label: 'Page' },
		{ action: 'map', label: 'Map' },
		{ action: 'view', label: '3D / Flat' },
		...(social ? [{ action: 'cheer-back', label: 'Cheer' }] : []),
	]);
	const WORLD_CELLS = [
		{ action: 'camera', label: 'Camera' },
		{ action: 'photo', label: 'Photo' },
	];
	const world = $derived(!!live.view?.world);
	// Photo's answer: the count of pictures it had when pressed (remoteLine).
	let photoFrom = $state<number | null>(null);
	const shown = $derived(remoteLine(live.view, photoFrom));
	function press(action: string) {
		if (action === 'photo') photoFrom = live.view?.pictures ?? 0;
		live.sendRemote(action);
	}
	const geared = gearsEnabled('phone');
	// The button the last shift tap was on carries the answer (#3334); before
	// any tap the gear the phone opened to sits on Harder.
	const SHIFTS = [
		['easier', 'Easier'],
		['harder', 'Harder'],
	] as const;
	let tapped = $state<'easier' | 'harder'>('harder');
	function shiftTap(action: 'easier' | 'harder') {
		tapped = action;
		live.sendRemote(action);
	}
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
		{#each CELLS as c, i (c.action)}
			<!-- Three cells alone: the last takes the row. -->
			<button
				type="button"
				class="{cell} {i === CELLS.length - 1 && CELLS.length % 2
					? 'col-span-2'
					: ''}"
				onclick={() => press(c.action)}
			>
				{c.label}
			</button>
		{/each}
		{#if social}
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
		{/if}
		{#each WORLD_CELLS as c (c.action)}
			<button
				type="button"
				class={cell}
				disabled={!world}
				onclick={() => press(c.action)}
			>
				{c.label}
			</button>
		{/each}
	</div>
	{#if !world}
		<p class="text-ink-muted text-2xl leading-7" data-testid="remote-hint">
			Camera and Photo need 3D.
		</p>
	{/if}

	{#if !geared}
		<div class="grid flex-1 auto-rows-fr grid-cols-2 gap-3">
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
		</div>
	{/if}

	{#if shown}
		<p
			class="text-neon text-center text-2xl"
			aria-live="polite"
			data-testid="remote-view"
		>
			{shown}
		</p>
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
		<!-- The riding screen's +1 min and Skip block (#4425), where its clock
		     ends the blocks; held with the line that says why where it does not. -->
		<div class="grid grid-cols-2 gap-3">
			<button
				type="button"
				class={cell}
				disabled={!live.pause.blocks}
				onclick={() => live.sendRemote('extend')}
			>
				+1 min
			</button>
			<button
				type="button"
				class={cell}
				disabled={!live.pause.blocks || live.pause.last}
				onclick={() => live.sendRemote('skip')}
			>
				Skip block
			</button>
		</div>
		{#if !live.pause.blocks || live.pause.last}
			<p class="text-ink-muted text-2xl leading-7" data-testid="remote-blocks">
				{live.pause.blocks ? LAST_BLOCK : NO_BLOCKS}
			</p>
		{/if}
	{/if}

	<!-- The most-used pair, last: under the thumb, the full width (#3334). -->
	{#if geared}
		<div class="grid flex-1 auto-rows-fr grid-cols-2 gap-3">
			{#each SHIFTS as [action, word] (action)}
				<button
					type="button"
					class="{cell} flex-col gap-1"
					onclick={() => shiftTap(action)}
				>
					{word}
					{#if live.gear && tapped === action}
						<span
							class="text-neon font-display text-2xl"
							aria-live="polite"
							data-testid="remote-gear">{answerLine(live.gear)}</span
						>
					{/if}
				</button>
			{/each}
		</div>
	{/if}

	{#if live.remoteRefusal}
		<p class="text-danger text-2xl leading-7" role="alert">
			{live.remoteRefusal}
		</p>
	{/if}
</div>
