<script lang="ts">
	import type { Snippet } from 'svelte';
	import {
		ListPlus,
		CalendarClock,
		Copy,
		Crown,
		Headphones,
		LogOut,
		Mic,
		MicOff,
		Music,
		ScreenShare,
		ScreenShareOff,
		SmilePlus,
		Video,
		VideoOff,
	} from '@lucide/svelte';
	import type { RoomEvent } from '$lib/protocol';
	import {
		eventText,
		roomTimeline,
		type TimelineMessage,
	} from '$lib/room/timeline';
	import ChatImage from '$lib/chat/ChatImage.svelte';
	import MessageText from '$lib/chat/MessageText.svelte';
	import Reactions from '$lib/chat/Reactions.svelte';
	import CheerIcon from '$lib/components/CheerIcon.svelte';
	import { formatTime } from '$lib/format';
	import { STOCK_CHEERS } from '$lib/icons';
	import ImageChip from '$lib/chat/ImageChip.svelte';
	import { createPendingImage } from '$lib/chat/pending-image.svelte';
	import { stickToBottom } from '$lib/chat/stick-to-bottom';
	import { toasts } from '$lib/toast.svelte';
	import { contextMenu, type MenuEntry } from '$lib/context-menu.svelte';
	import { personMenu } from '$lib/person-menu';
	import { goto } from '$app/navigation';
	import { account } from '$lib/account.svelte';
	import { roomConnection } from '$lib/room/connection.svelte';
	import { keepSize } from '$lib/pane';

	// Drag the left edge to change the width. Pointer capture keeps the drag
	// alive when the cursor outruns a 6 px strip; keepSize's observer saves
	// the width once it differs from what the class authored.
	function edgeResize(node: HTMLElement) {
		const grip = node.querySelector<HTMLElement>('[data-grip]');
		if (!grip) return;
		let from: { x: number; w: number } | null = null;
		const down = (e: PointerEvent) => {
			from = { x: e.clientX, w: node.offsetWidth };
			grip.setPointerCapture(e.pointerId);
			e.preventDefault();
		};
		const move = (e: PointerEvent) => {
			if (!from) return;
			const style = getComputedStyle(node);
			const min = parseFloat(style.minWidth) || 240;
			const max = parseFloat(style.maxWidth) || window.innerWidth;
			const w = from.w - (e.clientX - from.x);
			node.style.width = `${Math.round(Math.max(min, Math.min(max, w)))}px`;
		};
		const up = () => (from = null);
		grip.addEventListener('pointerdown', down);
		grip.addEventListener('pointermove', move);
		grip.addEventListener('pointerup', up);
		grip.addEventListener('pointercancel', up);
		return () => {
			grip.removeEventListener('pointerdown', down);
			grip.removeEventListener('pointermove', move);
			grip.removeEventListener('pointerup', up);
			grip.removeEventListener('pointercancel', up);
		};
	}
	import Avatar from '$lib/components/Avatar.svelte';
	import ProgressBar from '$lib/components/ProgressBar.svelte';
	import RidingBars from '$lib/components/RidingBars.svelte';
	import RiderVolume from '$lib/room/RiderVolume.svelte';
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
	let {
		live,
		riders = [],
		player,
		messages = [],
		events = [],
		slug = undefined,
		onCheer,
		onChat,
		onQueue,
		reactions = {},
		myReacts = {},
		onReact,
		cheers = STOCK_CHEERS,
	}: {
		live: boolean;
		/** Who is here (ADR-0020, #181 gap 3) — the roster sits above the chat. */
		riders?: RoomRider[];
		/** The jukebox playlist renders into the panel's top slot. */
		player?: Snippet;
		/** A YouTube link in the chat is one tap from the jukebox. */
		onQueue?: (url: string) => void;
		/** Room chat — a bounded log since ADR-0010's amendment (#201). */
		messages?: TimelineMessage[];
		/** What the room did (#321) — jukebox lines, interleaved with the talking. */
		events?: RoomEvent[];
		/** Needed to address pasted images (#279); absent = text-only chat. */
		slug?: string;
		/** messageId → emoji → count (shared truth). */
		reactions?: Record<string, Record<string, number>>;
		/** "id:emoji" → I pressed it. */
		myReacts?: Record<string, boolean>;
		onReact?: (messageId: string, emoji: string) => void;
		onCheer?: (emoji: string) => void;
		/** A pasted image rides along as a blob; the parent owns the upload. */
		onChat?: (text: string, image?: Blob) => void;
		/** The room's one reaction vocabulary (#223), icon keys (#447) — cheers thrown, reactions attached. */
		cheers?: string[];
	} = $props();

	// The way into voice, where the people are (#437).
	const av = $derived(roomConnection.current?.av);

	let reactingTo = $state<string | null>(null);

	// A message's right-click (#465): react, copy, queue the link it carries.
	const YOUTUBE = /https?:\/\/[^\s]*(?:youtube\.com|youtu\.be)[^\s]*/;
	function messageMenu(message: { id?: string; text: string }): MenuEntry[] {
		const entries: MenuEntry[] = [];
		if (message.id && onReact) {
			const id = message.id;
			entries.push({
				label: 'React',
				icon: SmilePlus,
				onSelect: () => (reactingTo = id),
			});
		}
		if (message.text)
			entries.push({
				label: 'Copy text',
				icon: Copy,
				onSelect: () => void navigator.clipboard?.writeText(message.text),
			});
		const link = message.text.match(YOUTUBE)?.[0];
		if (link && onQueue) {
			const url = link;
			entries.push({
				label: 'Queue on the jukebox',
				icon: ListPlus,
				onSelect: () => onQueue(url),
			});
		}
		return entries;
	}

	// Chat is the room's timeline (#321): what riders typed and what the room
	// did, in one chronological list.
	const timeline = $derived(roomTimeline(messages, events));

	// Consecutive lines from one rider read as one turn — the header repeats
	// only after a gap, like every messenger.
	const GROUP_GAP_MS = 5 * 60_000;

	async function copy(text: string) {
		try {
			await navigator.clipboard.writeText(text);
			toasts.push('Message copied');
		} catch {
			toasts.push('Copy needs clipboard permission', { tone: 'error' });
		}
	}

	let draft = $state('');
	// A pasted image waiting on the send button (#279) — Discord's flow:
	// Ctrl+V, see the chip, hit Enter.
	const pending = createPendingImage((refusal) =>
		toasts.push(refusal, { tone: 'error' }),
	);

	function sendChat() {
		const text = draft.trim();
		if (!text && !pending.current) return;
		onChat?.(text, pending.take());
		draft = '';
	}
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
	{@attach edgeResize}
	class="border-ink/5 relative h-full w-80 shrink-0 overflow-hidden border-l"
	style="min-width: 240px; max-width: 40vw"
>
	<div
		data-grip
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
				class="border-ink/5 min-h-0 shrink-0 overflow-y-auto border-b {live
					? 'max-h-[45%]'
					: 'max-h-56'}"
			>
				<div class="eyebrow flex items-center gap-1.5 px-3 pt-3 pb-1">
					{#if !live}<Headphones size={10} />{/if}
					{live
						? `holding target — ${here.length}`
						: `in voice — ${here.length}`}
				</div>
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
					</div>
				{/if}
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
			</div>
		{/if}
		{#if player}
			<!-- The deck, capped: with a seated player plus queue and history it
			     grew until the chat was a sliver (#461). Its own scroll past 45%. -->
			<div class="border-ink/5 max-h-[45%] overflow-y-auto border-b p-4">
				{@render player()}
			</div>
		{/if}

		<div class="eyebrow px-4 pt-3 pb-1">chat</div>
		<!-- `mt-auto` on the list, not `justify-end` on the box (#291): the
		     spare room goes above the oldest line, so overflow spills off the
		     END edge and scrollback is reachable. -->
		<div
			{@attach stickToBottom}
			data-testid="chat-log"
			class="flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto px-4 py-2"
		>
			<ul class="mt-auto space-y-2">
				{#each timeline as entry, i (entry.key)}
					{#if entry.kind === 'event'}
						<!-- An event, not a message: no avatar, no reactions, nothing to
					     copy. The room talking about itself stays quieter than the
					     people in it. -->
						{@const Mark =
							entry.event.kind === 'session' ? CalendarClock : Music}
						<li
							class="text-muted/60 flex items-baseline gap-1.5 text-[11px] leading-snug"
						>
							<Mark size={11} class="shrink-0 translate-y-0.5 opacity-70" />
							<span class="min-w-0 wrap-anywhere">{eventText(entry.event)}</span
							>
							<span class="text-muted/40 ml-auto shrink-0 font-mono text-[10px]"
								>{formatTime(entry.at)}</span
							>
						</li>
					{:else}
						{@const message = entry.message}
						{@const prev = timeline[i - 1]}
						{@const grouped =
							prev?.kind === 'message' &&
							prev.message.from === message.from &&
							message.at - prev.at < GROUP_GAP_MS}
						<li
							class="group text-xs leading-snug {grouped ? '-mt-1.5' : ''}"
							{@attach contextMenu(() => messageMenu(message))}
						>
							<div class="flex items-baseline gap-1.5">
								{#if !grouped}
									<span class="text-muted min-w-0 truncate font-medium"
										>{message.from}</span
									>
									<span class="text-muted/40 shrink-0 font-mono text-[10px]"
										>{formatTime(message.at)}</span
									>
								{/if}
								<span
									class="ml-auto flex shrink-0 gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100"
								>
									{#if message.text}
										<button
											onclick={() => copy(message.text)}
											class="text-muted/60 hover:text-ink"
											aria-label="copy message"><Copy size={12} /></button
										>
									{/if}
									{#if message.id && onReact}
										{@const id = message.id}
										<button
											onclick={() =>
												(reactingTo = reactingTo === id ? null : id)}
											class="text-muted/60 hover:text-ink"
											aria-label="react"><SmilePlus size={13} /></button
										>
									{/if}
								</span>
							</div>
							<!-- An image-only line has no text to render; MessageText turns a
				     lone GIF link into the GIF itself. -->
							{#if message.text}
								<div class="text-ink/85 wrap-anywhere">
									<MessageText text={message.text} {onQueue} />
								</div>
							{/if}
							{#if message.imageId && slug}
								<ChatImage
									src="/api/rooms/{slug}/chat/images/{message.imageId}"
									alt="Sent by {message.from}"
								/>
							{/if}
							{#if message.id && onReact}
								{@const id = message.id}
								<Reactions
									{id}
									counts={reactions[id]}
									{myReacts}
									{cheers}
									picking={reactingTo === id}
									onReact={(cheer) => {
										onReact(id, cheer);
										reactingTo = null;
									}}
								/>
							{/if}
						</li>
					{/if}
				{:else}
					<li class="text-muted/60 text-xs">
						Warm-up talk lands here — the room keeps the recent history. Voice
						stays the main channel.
					</li>
				{/each}
			</ul>
		</div>

		<div class="border-ink/5 border-t p-3">
			{#if !live}
				<!-- Typing is a lounge activity; mid-ride it collapses to reactions. -->
				<ImageChip image={pending.current} onClear={pending.clear} />
				<form
					class="mb-2 flex gap-1.5"
					onsubmit={(e) => {
						e.preventDefault();
						sendChat();
					}}
				>
					<input
						bind:value={draft}
						onpaste={pending.paste}
						maxlength="500"
						placeholder="Say something…"
						class="input input-xs min-w-0 flex-1"
					/>
					<button
						disabled={!draft.trim() && !pending.current}
						class="btn btn-secondary btn-xs">Send</button
					>
				</form>
			{/if}
			<!-- Mid-ride: typing is off the table, so the affordance is reactions, not a text field. -->
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
