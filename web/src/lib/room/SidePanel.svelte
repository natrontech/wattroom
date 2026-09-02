<script lang="ts">
	import type { Snippet } from 'svelte';
	import {
		ChevronDown,
		ChevronRight,
		Crown,
		Headphones,
		LogOut,
		Mic,
		MicOff,
		ScreenShare,
		ScreenShareOff,
		Video,
		VideoOff,
	} from '@lucide/svelte';
	import CheerIcon from '$lib/components/CheerIcon.svelte';
	import { STOCK_CHEERS } from '$lib/icons';
	import { contextMenu } from '$lib/context-menu.svelte';
	import { personMenu } from '$lib/person-menu';
	import { goto } from '$app/navigation';
	import { account } from '$lib/account.svelte';
	import { roomConnection } from '$lib/room/connection.svelte';
	import { keepSize } from '$lib/pane';
	import { stageSlot } from '$lib/room/stage-slot.svelte';
	import { clampSize, dividerDrag } from '$lib/divider';
	import type { Missed } from '$lib/room/unread';

	// The divider between the room and this column. keepSize's observer saves
	// the width it writes, the same way it did for the native `resize` grip.
	function edgeResize(grip: HTMLElement) {
		const panel = grip.parentElement;
		if (!panel) return;
		return dividerDrag(grip, {
			axis: 'x',
			// The panel is right of its divider: pulling left makes it wider.
			sign: -1,
			from: () => panel.offsetWidth,
			to: (width) => {
				const style = getComputedStyle(panel);
				panel.style.width = `${clampSize(
					width,
					parseFloat(style.minWidth) || 240,
					parseFloat(style.maxWidth) || window.innerWidth,
				)}px`;
			},
		});
	}
	import Avatar from '$lib/components/Avatar.svelte';
	import ProgressBar from '$lib/components/ProgressBar.svelte';
	import RidingBars from '$lib/components/RidingBars.svelte';
	import RiderVolume from '$lib/room/RiderVolume.svelte';
	import QuickAudio from '$lib/room/QuickAudio.svelte';
	import type { RoomRider } from '$lib/room/view';

	// The room's people and the room's talk, in one column (ADR-0020). Discord's
	// right column is WHO IS HERE; ours was chat alone, so the roster was
	// legible only from tiles that vanish behind the stage.
	//
	// Stacked rather than tabbed: the roster has to be there without being
	// asked for — that is the whole "this room is populated" read — and giving
	// members a column of their own took content to 530 px at 1280, which the
	// tile grid does not survive.
	//
	// Plus one slot: the jukebox playlist owns the whole queue surface (#286).
	//
	// The log itself left for the Chat place (#504, mock A): three surfaces
	// were sharing this height and none of them had enough. What stays behind
	// is one line saying what you missed.
	let {
		live,
		riders = [],
		player,
		missed = null,
		onOpenChat,
		onCheer,
		cheers = STOCK_CHEERS,
	}: {
		live: boolean;
		/** Who is here (ADR-0020, #181 gap 3) — the roster owns the column. */
		riders?: RoomRider[];
		/** The jukebox playlist renders into the panel's top slot. */
		player?: Snippet;
		/** What was said while you were elsewhere; null when nothing was. */
		missed?: Missed | null;
		onOpenChat?: () => void;
		onCheer?: (emoji: string) => void;
		/** The room's one reaction vocabulary (#223), icon keys (#447). */
		cheers?: string[];
	} = $props();

	// Three things share this column and it never had the height for all of
	// them (#504). The roster folds to a wrap of faces; mid-ride it starts
	// open, because that is where the execution bars are, and a rider's own
	// choice outranks both. The voice controls never fold — they are the way
	// in, and a way in you have to unfold is not one (ux.md).
	const PEOPLE_KEY = 'wattroom.room.people.v1';
	function readChoice(): boolean | null {
		try {
			const stored = localStorage.getItem(PEOPLE_KEY);
			return stored === null ? null : stored === '1';
		} catch {
			return null;
		}
	}
	let choice = $state<boolean | null>(readChoice());
	const peopleOpen = $derived(choice ?? live);
	function togglePeople() {
		choice = !peopleOpen;
		try {
			localStorage.setItem(PEOPLE_KEY, choice ? '1' : '0');
		} catch {
			/* desk-only preference; losing it costs one tap */
		}
	}

	// The way into voice, where the people are (#437).
	const av = $derived(roomConnection.current?.av);
</script>

{#snippet person(rider: RoomRider)}
	<!-- 44 px rows (#463): the speaker at the end is tapped from a bike, and
	     the slider it opens wraps onto a line of its own under the name. -->
	<li
		class="flex min-h-11 flex-wrap items-center gap-2 rounded px-2 py-1 text-xs {rider.speaking
			? 'text-ink'
			: 'text-ink/70'}"
		{@attach contextMenu(() => (rider.you ? [] : personMenu(rider.id, goto)))}
	>
		<span class="relative shrink-0">
			<Avatar name={rider.name} size={22} />
			{#if rider.watts > 0}
				<!-- Riding is motion, not a red-adjacent dot (ADR-0020). -->
				<span
					class="bg-surface ring-surface absolute -right-1 -bottom-1 rounded-full px-0.5 py-px ring-2"
				>
					<RidingBars size={8} />
				</span>
			{:else}
				<span
					class="bg-z4 ring-surface absolute -right-0.5 -bottom-0.5 h-2 w-2 rounded-full ring-2"
				></span>
			{/if}
		</span>
		<span class="min-w-0 flex-1">
			<span class="flex items-center gap-1.5">
				<span
					class="min-w-0 flex-1 truncate {rider.speaking ? 'font-medium' : ''}"
					>{rider.name}</span
				>
				{#if rider.coach}<Crown size={11} class="text-muted shrink-0" />{/if}
				{#if rider.cameraOn}<Video size={11} class="text-muted shrink-0" />{/if}
				{#if rider.speaking}
					<Mic size={11} class="text-z4 shrink-0 animate-pulse" />
				{:else if rider.muted}
					<MicOff size={11} class="text-muted/50 shrink-0" />
				{/if}
				{#if live && rider.watts > 0}
					<span class="text-muted shrink-0 text-[10px] tabular-nums"
						>{Math.round(rider.execution * 100)}%</span
					>
				{/if}
			</span>
			{#if live && rider.watts > 0}
				<!-- Execution moved off the training surface (ADR-0020): how well
				     everyone is holding target is roster data, and this is the
				     roster. It also gives the column a job mid-ride, when nobody
				     is typing. -->
				<span class="mt-1 block">
					<ProgressBar
						pct={rider.execution * 100}
						h="h-1"
						fill={rider.you ? 'bg-watt' : 'bg-neon/70'}
						title="{rider.name} is holding target {Math.round(
							rider.execution * 100,
						)}% of the time"
					/>
				</span>
			{/if}
		</span>
		{#if rider.inVoice && !rider.you}
			<RiderVolume id={rider.id} name={rider.name} />
		{/if}
	</li>
{/snippet}

<!-- Resizable (#280) from its left edge. The browser's own `resize` grip is a
     corner of diagonal lines that belongs to no design; this is a 6 px strip
     on the border that lights up on hover and drags. keepSize persists the
     width it sets, the same way it did for the native grip. -->
<aside
	{@attach (node) => keepSize(node, 'side-panel')}
	class="border-ink/5 relative h-full w-80 shrink-0 overflow-hidden border-l"
	style="min-width: 240px; max-width: 40vw"
>
	<div
		{@attach edgeResize}
		class="hover:bg-neon/40 active:bg-neon/60 absolute inset-y-0 left-0 z-10 w-1.5 cursor-col-resize touch-none transition-colors"
		role="separator"
		aria-orientation="vertical"
		aria-label="resize the panel"
	></div>
	<div class="flex h-full flex-col">
		{#if riders.length > 0}
			<!-- Mid-ride the useful split is riding / not; in the lounge it is
			     voice / not, and the heading says which question it answers. -->
			{@const here = live
				? riders.filter((r) => r.watts > 0)
				: riders.filter((r) => r.inVoice)}
			{@const away = riders.filter((r) => !here.includes(r))}
			<div
				class="border-ink/5 min-h-0 overflow-y-auto border-b {peopleOpen
					? 'flex-1'
					: 'shrink-0'}"
			>
				<!-- Closed, the roster is still the "this room is populated" read
				     (ADR-0020) — the faces stay, the rows go. That is what buys the
				     chat its height back (#504), and it is why this is a wrap of
				     avatars and not a disclosure triangle over nothing. -->
				<button
					onclick={togglePeople}
					aria-expanded={peopleOpen}
					class="flex w-full items-center gap-2 px-3 pt-3 pb-1 text-left"
				>
					{#if peopleOpen}
						<span class="eyebrow flex flex-1 items-center gap-1.5">
							{#if !live}<Headphones size={10} />{/if}
							{live
								? `holding target — ${here.length}`
								: `in voice — ${here.length}`}
						</span>
						<ChevronDown size={13} class="text-muted shrink-0" />
					{:else}
						<span class="flex min-w-0 flex-1 flex-wrap items-center gap-1">
							{#each riders.slice(0, 8) as rider (rider.id)}
								<span
									class={rider.speaking ? 'ring-z4 rounded-full ring-2' : ''}
									title={rider.name}
								>
									<Avatar name={rider.name} size={22} />
								</span>
							{/each}
							{#if riders.length > 8}
								<span class="text-muted text-[10px]">+{riders.length - 8}</span>
							{/if}
						</span>
						<span class="text-muted shrink-0 text-[10px] tabular-nums"
							>{riders.length} · {live
								? `${here.length} riding`
								: `${here.length} in voice`}</span
						>
						<ChevronRight size={13} class="text-muted shrink-0" />
					{/if}
				</button>
				{#if av && account.me?.avEnabled}
					<!-- Labelled and big enough for a bike: two grey icons in the
					     you-panel did not read as the way into voice (#437). -->
					<div class="flex flex-wrap items-center gap-1.5 px-3 pb-2">
						{#if av.status === 'off' || av.status === 'failed'}
							<button
								onclick={() => void av.join()}
								class="btn btn-primary btn-xs"
								><Headphones size={13} /> Join voice</button
							>
							<span class="text-muted text-[10px]"
								>camera and screen once you are in</span
							>
						{:else if av.status === 'connecting' || av.status === 'reconnecting'}
							<span class="text-muted text-xs"
								>{av.status === 'connecting'
									? 'joining voice…'
									: 'voice reconnecting…'}</span
							>
						{:else}
							<button
								onclick={() => av.toggleMic()}
								aria-pressed={av.micOn}
								class="btn btn-xs {av.micOn ? 'btn-secondary' : 'btn-danger'}"
								>{#if av.micOn}<Mic size={13} /> Mic{:else}<MicOff size={13} /> Muted{/if}</button
							>
							<button
								onclick={() => av.toggleCam()}
								aria-pressed={av.camOn}
								class="btn btn-secondary btn-xs"
								>{#if av.camOn}<Video size={13} /> Camera on{:else}<VideoOff
										size={13}
									/> Camera{/if}</button
							>
							<button
								onclick={() => void av.toggleShare()}
								aria-pressed={av.sharing}
								class="btn btn-secondary btn-xs"
								>{#if av.sharing}<ScreenShareOff size={13} /> Stop sharing{:else}<ScreenShare
										size={13}
									/> Share{/if}</button
							>
							<button
								onclick={() => av.leave()}
								class="btn btn-ghost btn-xs"
								title="leave voice"><LogOut size={13} /> Leave voice</button
							>
						{/if}
						<!-- The mix and the gate, without leaving the room (#477). -->
						<QuickAudio />
					</div>
				{/if}
				{#if peopleOpen}
					<ul class="px-1">
						{#each here as rider (rider.id)}{@render person(rider)}{/each}
					</ul>
					{#if away.length > 0}
						<div class="eyebrow px-3 pt-3 pb-1">
							{live
								? `not pedalling — ${away.length}`
								: `in the room — ${away.length}`}
						</div>
						<ul class="px-1 pb-2">
							{#each away as rider (rider.id)}{@render person(rider)}{/each}
						</ul>
					{/if}
				{/if}
			</div>
		{/if}
		{#if player}
			<!-- The deck, capped: with a seated player plus queue and history it
			     grew until the chat was a sliver (#461). Its own scroll past 45%.
			     While the stage or TV has the player the deck hides its 200 px
			     hole, so the cap comes down with it — otherwise the queue simply
			     spreads into the freed space and nothing is better off (#504).
			     With the roster folded away the deck takes the column instead:
			     whatever you have open gets the height, which is the whole idea. -->
			<div
				class="border-ink/5 min-h-0 overflow-y-auto border-b p-4 {!peopleOpen
					? 'flex-1'
					: stageSlot.outranked
						? 'max-h-40'
						: 'max-h-[45%]'}"
			>
				{@render player()}
			</div>
		{/if}

		{#if missed}
			<!-- What the chat left behind (#504, mock A): one line of what was
			     said while you were elsewhere, and the way to the rest of it.
			     Quiet — the count is chrome, and chrome does not glow. -->
			<button
				onclick={onOpenChat}
				class="border-ink/5 bg-surface-raised hover:bg-surface-raised/70 flex shrink-0 items-center gap-2 border-t px-3 py-3 text-left"
			>
				<span class="bg-neon h-2 w-2 shrink-0 rounded-full"></span>
				<span class="min-w-0 flex-1 truncate text-xs"
					><span class="text-muted">{missed.from}:</span>
					{missed.preview}</span
				>
				<span class="text-muted shrink-0 text-[10px]">{missed.count} new</span>
				<ChevronRight size={13} class="text-muted shrink-0" />
			</button>
		{/if}
		<div class="border-ink/5 border-t p-3">
			<!-- The room's reactions. Typing lives on the Chat place now, and
			     mid-ride it was never on the table anyway (ux.md). -->
			<div class="flex gap-1.5">
				{#each cheers.slice(0, 4) as cheer (cheer)}
					<button
						onclick={() => onCheer?.(cheer)}
						aria-label={cheer}
						title={cheer}
						class="border-muted/20 hover:border-muted/50 flex flex-1 items-center justify-center rounded border py-2"
						><CheerIcon {cheer} size={18} /></button
					>
				{/each}
			</div>
		</div>
	</div>
</aside>
