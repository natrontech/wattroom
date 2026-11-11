<script lang="ts">
	/**
	 * This phone as the remote for the rider's other screen (#3217, ADR-0025):
	 * the now bar's controls, from the one list both draw (ride-controls.ts),
	 * so the two cannot drift apart again (rider feedback, 2026-11). The view
	 * row is the riding screen's view switch, TV and Flag are its own TV mode
	 * and ⚑, and each is held, with one line that says why, while that
	 * screen does not offer it.
	 *
	 * It fits the screen exactly, whatever the phone (an iPhone 17 in Safari
	 * scrolled a few pixels): every row shares the height left after the
	 * header, with a 48 px floor, and nothing is a fixed sum of heights.
	 *
	 * Every press is a closed-set RemoteCommand the holding tab runs through
	 * its own controls. Easier and Harder tap and never hold: a lost release
	 * measured up to 5 phantom shifts. Only Talk holds, with a beat
	 * (remote-talk.ts). Chrome, not live data: neon, never the watt accent
	 * (ADR-0005).
	 *
	 * `link` is the way to the riding screen: a voice channel's socket, or the
	 * rider's own lane for a ride alone (#4425). Talk and Cheer reach a call
	 * and a channel, so a ride alone draws neither (`social`).
	 */
	import { onDestroy, onMount, untrack } from 'svelte';
	import { play } from '$lib/sound/cues';
	import type { RemoteLink } from '$lib/ride/remote-link';
	import { gearsEnabled } from '$lib/ride/gears-enabled';
	import { createTalkHold } from '$lib/ride/remote-talk';
	import { keepAwakeWhile } from '$lib/workout/keep-awake.svelte';
	import {
		answerLine,
		CONTROLS,
		LOOK_WORDS,
		phoneTiles,
		phoneViews,
		remoteLine,
		type RideControl,
	} from '$lib/ride/ride-controls';
	import Mic from '@lucide/svelte/icons/mic';

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

	const shown = $derived(
		phoneTiles({ view: live.view, pause: live.pause, social }),
	);
	const views = $derived(phoneViews(live.view));

	// Photo's and Flag's answers: the counts the screen had when pressed.
	let since = $state<{ pictures: number | null; flags: number | null }>({
		pictures: null,
		flags: null,
	});
	const line = $derived(remoteLine(live.view, !!live.pause?.paused, since));
	// The shutter here too, when the riding screen says it took one (#4495).
	let heard = untrack(() => live.view?.pictures ?? 0);
	$effect(() => {
		const pictures = live.view?.pictures ?? 0;
		if (pictures > heard) play('shutter');
		heard = pictures;
	});

	// End ends a ride that cannot be resumed (#2623): the phone asks with a
	// second tap, so the riding screen ends it at once.
	const END_ARMED_MS = 3000;
	let arming = $state(false);
	let disarm: ReturnType<typeof setTimeout> | undefined;
	onDestroy(() => clearTimeout(disarm));

	function press(control: RideControl) {
		if (control === 'photo')
			since = { pictures: live.view?.pictures ?? 0, flags: null };
		if (control === 'flag')
			since = { pictures: null, flags: live.view?.flags ?? 0 };
		if (control === 'end' && !arming) {
			arming = true;
			disarm = setTimeout(() => (arming = false), END_ARMED_MS);
			return;
		}
		if (control === 'end') {
			clearTimeout(disarm);
			arming = false;
		}
		live.sendRemote(control);
	}

	const geared = gearsEnabled('phone');
	// The button the last shift tap was on carries the answer (#3334); before
	// any tap the gear the phone opened to sits on Harder.
	const SHIFTS = $derived([
		['easier', geared ? 'Easier' : 'Bias −'],
		['harder', geared ? 'Harder' : 'Bias +'],
	] as const);
	let tapped = $state<'easier' | 'harder'>('harder');
	function shiftTap(action: 'easier' | 'harder') {
		tapped = action;
		live.sendRemote(action);
	}
	const talk = createTalkHold((action) => live.sendRemote(action));
	onDestroy(talk.up);
	// A phone that opens late asks the holder where it is: its gear, view
	// and whether the ride is a solo one it may pause.
	onMount(() => live.sendRemote('sync'));
	// A remote that sleeps mid-ride is a phone to unlock with sweaty hands (#4219).
	keepAwakeWhile(() => true);

	// A row's floor is 48 px, a thumb's target (ux.md); `min-h-0` lets the
	// rows share what the screen has rather than add up past it.
	const key =
		'btn btn-accent min-h-12 min-w-0 px-2 font-semibold disabled:cursor-not-allowed disabled:opacity-40 aria-pressed:bg-neon/20 aria-pressed:border-neon';
</script>

<div
	class="bg-surface safe-p-3 fixed inset-0 z-50 flex touch-manipulation flex-col gap-2 overflow-y-auto overscroll-contain"
	role="dialog"
	aria-label="Phone remote"
	data-testid="phone-remote"
>
	<div class="flex shrink-0 items-center justify-between gap-3">
		<div class="min-w-0">
			<h2 class="text-2xl leading-8 font-semibold">Remote</h2>
			<p
				class="text-neon truncate text-lg leading-6"
				aria-live="polite"
				data-testid="remote-view"
			>
				{line ?? 'Waiting for your riding screen…'}
			</p>
		</div>
		<button
			type="button"
			class="btn btn-accent btn-ride shrink-0 text-xl!"
			onclick={onclose}
		>
			Done
		</button>
	</div>

	{#if views.length}
		<!-- The riding screen's view switch, its segments as it draws them. -->
		<div
			class="grid min-h-12 shrink-0 gap-2"
			style="grid-template-columns: repeat({views.length}, minmax(0, 1fr))"
			role="group"
			aria-label="View"
		>
			{#each views as v (v.segment)}
				<button
					type="button"
					class="{key} text-xl"
					aria-pressed={v.pressed}
					onclick={() => !v.pressed && live.sendRemote(`view-${v.segment}`)}
				>
					{LOOK_WORDS[v.segment]}
				</button>
			{/each}
		</div>
	{/if}

	<div class="grid min-h-0 flex-[3] auto-rows-fr grid-cols-3 gap-2">
		{#each shown.tiles as t (t.control)}
			{@const c = CONTROLS[t.control]}
			<button
				type="button"
				class="{key} flex-col gap-0.5 text-lg leading-6 {t.control === 'end' &&
				arming
					? 'border-danger text-danger'
					: ''}"
				disabled={t.disabled}
				aria-pressed={t.pressed}
				aria-label={c.label}
				onclick={() => press(t.control)}
			>
				<c.icon size={26} aria-hidden="true" />
				<span class="truncate"
					>{t.control === 'end' && arming ? 'Tap again' : c.word}</span
				>
			</button>
		{/each}
	</div>

	{#if social}
		<button
			type="button"
			class="{key} min-h-14 shrink-0 gap-2 text-xl"
			style="touch-action: none"
			onpointerdown={talk.down}
			onpointerup={talk.up}
			onpointerleave={talk.up}
			onpointercancel={talk.up}
			oncontextmenu={(event) => event.preventDefault()}
		>
			<Mic size={24} aria-hidden="true" /> Hold to talk
		</button>
	{/if}

	{#if live.remoteRefusal}
		<p class="text-danger line-clamp-2 shrink-0 text-lg leading-6" role="alert">
			{live.remoteRefusal}
		</p>
	{:else if shown.hint}
		<p
			class="text-muted line-clamp-2 shrink-0 text-lg leading-6"
			data-testid="remote-hint"
		>
			{shown.hint}
		</p>
	{/if}

	<!-- The most-used pair, last: under the thumb, the full width, the
	     tallest row (#3334). -->
	<div class="grid min-h-24 flex-[2] grid-cols-2 gap-2">
		{#each SHIFTS as [action, word] (action)}
			<button
				type="button"
				class="{key} flex-col gap-1 text-2xl"
				onclick={() => shiftTap(action)}
			>
				{word}
				{#if live.gear && tapped === action}
					<span
						class="text-neon font-display text-xl"
						aria-live="polite"
						data-testid="remote-gear">{answerLine(live.gear)}</span
					>
				{/if}
			</button>
		{/each}
	</div>
</div>
