<script lang="ts">
	import { MaxMessageChars } from '$lib/protocol';
	// The thread's composer (#468, #672): the draft, an attached or pasted
	// image, the GIF picker, and the send. Split out of MessageThread for
	// size; it owns the focus rule too — the box takes focus on navigation
	// and never from a control the rider chose.
	import BellRing from '@lucide/svelte/icons/bell-ring';
	import ImageIcon from '@lucide/svelte/icons/image';
	import ImagePlay from '@lucide/svelte/icons/image-play';
	import Smile from '@lucide/svelte/icons/smile';
	import Timer from '@lucide/svelte/icons/timer';
	import X from '@lucide/svelte/icons/x';
	import { openMenu } from '$lib/context-menu.svelte';
	import { TemporaryDay, TemporaryHour, TemporaryWeek } from '$lib/protocol';
	import { onMount, tick } from 'svelte';
	import { afterNavigate } from '$app/navigation';
	import { account } from '$lib/account.svelte';
	import { completeMention, mentionCompletion } from '$lib/messages/mention';
	import Banner from '$lib/components/Banner.svelte';
	import DraftEmoji from '$lib/chat/DraftEmoji.svelte';
	import GifPicker from '$lib/chat/GifPicker.svelte';
	import type { Gif } from '$lib/chat/gifs';
	import ImageChip from '$lib/chat/ImageChip.svelte';
	import { createPendingImage } from '$lib/chat/pending-image.svelte';
	import { fitsText, sendsOnEnter } from '$lib/chat/textarea';
	import EmojiPicker from '$lib/emoji/EmojiPicker.svelte';

	let {
		send: deliver,
		lineGapMs = 1000,
		placeholder,
		hint,
		error = null,
		lock = null,
		names = [],
		crewId,
		poke,
	}: {
		/** Null when it went; the refusal to show when it did not. */
		send: (
			text: string,
			image?: Blob,
			expiresIn?: number,
		) => Promise<string | null>;
		/** The smallest gap between two lines this surface accepts; 0 for none. */
		lineGapMs?: number;
		placeholder: string;
		hint?: string;
		/** A banner unrelated to the last send attempt — the thread's own error. */
		error?: string | null;
		/**
		 * Why nothing can be sent here, when nothing can (ux.md: a box that
		 * would refuse the line is disabled and says so, never a 403 on Send).
		 */
		lock?: string | null;
		/** Who `@` can complete to (#1766): the people in this thread. */
		names?: string[];
		/** The crew whose own emoji the picker offers; none in a DM. */
		crewId?: string;
		/**
		 * A DM's toggle to send the next line as a poke (#2721) — the timer's
		 * pattern: pressed changes how the line goes, pressed again undoes it.
		 */
		poke?: { on: boolean; toggle: () => void };
	} = $props();

	let draft = $state('');
	let composer = $state<HTMLTextAreaElement | null>(null);

	// `@` completes over the thread's people (#1766). Escape puts the list
	// away for this draft; typing on brings it back.
	let dismissed = $state('');
	const mention = $derived(
		draft === dismissed ? null : mentionCompletion(draft, names),
	);
	let pick = $state(0);
	const listId = `mention-${Math.random().toString(36).slice(2, 8)}`;
	const optionId = (i: number) => `${listId}-${i}`;
	$effect(() => {
		mention;
		pick = 0;
	});
	function complete(name: string) {
		if (!mention) return;
		draft = completeMention(draft, mention.at, name);
		composer?.focus({ preventScroll: true });
	}
	function onKey(e: KeyboardEvent) {
		if (!mention) {
			if (!sendsOnEnter(e)) return;
			e.preventDefault();
			void send();
			return;
		}
		const { hits } = mention;
		if (e.key === 'ArrowDown') pick = (pick + 1) % hits.length;
		else if (e.key === 'ArrowUp') pick = (pick + hits.length - 1) % hits.length;
		else if (e.key === 'Enter' || e.key === 'Tab') complete(hits[pick]);
		else if (e.key === 'Escape') dismissed = draft;
		else return;
		e.preventDefault();
	}
	// The account gate can mount this thread after initial navigation finished.
	onMount(() => composer?.focus({ preventScroll: true }));
	// Navigation includes switching peers in the reused DM page. Live updates
	// must never take focus back from another control the rider chose.
	afterNavigate(async () => {
		await tick();
		composer?.focus({ preventScroll: true });
	});
	let sending = $state(false);
	let sendError = $state<string | null>(null);
	const pending = createPendingImage((refusal) => (sendError = refusal));
	let filePicker = $state<HTMLInputElement | null>(null);

	// A room's hub took one line a second per rider and said so (#1762);
	// saying it here first kept the draft and the picture in the box instead
	// of round-tripping a refusal for words already cleared. The gap is the
	// caller's (#1819): a DM and a text channel have no such rule, and a GIF
	// is a line like any other.
	let lastSentAt = 0;
	function tooSoon(): boolean {
		if (Date.now() - lastSentAt >= lineGapMs) return false;
		sendError = 'One line a second — a moment, then send it again.';
		return true;
	}
	async function send() {
		const text = draft.trim();
		const image = pending.current?.blob;
		if (!text && !image) return;
		if (tooSoon()) return;
		draft = '';
		sending = true;
		const refused = await deliver(text, image, expiresIn || undefined);
		sending = false;
		sendError = refused;
		// A refused message is not a deleted one — nor is its picture: the
		// blob used to be taken and revoked before the send resolved (#1762).
		if (refused) draft = text;
		else {
			lastSentAt = Date.now();
			pending.clear();
		}
	}

	// A temporary message (#2644): the timer stays set for every line until
	// the rider takes it off — a run of lines meant to vanish is one choice,
	// not one per line — and the chip above the box says it is on.
	const TIMERS: [number, string][] = [
		[TemporaryHour, '1 hour'],
		[TemporaryDay, '24 hours'],
		[TemporaryWeek, '7 days'],
	];
	let expiresIn = $state(0);
	const timerLabel = $derived(TIMERS.find(([s]) => s === expiresIn)?.[1]);
	function pickTimer(e: MouseEvent & { currentTarget: HTMLElement }) {
		const at = e.currentTarget.getBoundingClientRect();
		openMenu(
			[
				...TIMERS.map(([seconds, label]) => ({
					label: `Disappears after ${label}`,
					icon: Timer,
					hint: seconds === expiresIn ? 'on' : undefined,
					onSelect: () => (expiresIn = seconds),
				})),
				'separator' as const,
				{
					label: 'Stays',
					hint: expiresIn ? undefined : 'on',
					onSelect: () => (expiresIn = 0),
				},
			],
			at.left,
			at.top - 4,
			e.currentTarget,
		);
	}

	// An emoji goes in at the caret (#2643) — a crew's own as the `:name:`
	// the line then draws — and the caret lands after it.
	let emojiButton = $state<HTMLButtonElement | null>(null);
	let emojiOpen = $state(false);
	async function insertEmoji(key: string) {
		emojiOpen = false;
		const box = composer;
		const at = box?.selectionStart ?? draft.length;
		const end = box?.selectionEnd ?? at;
		draft = draft.slice(0, at) + key + draft.slice(end);
		await tick();
		box?.focus({ preventScroll: true });
		box?.setSelectionRange(at + key.length, at + key.length);
	}

	// A picked GIF is its own message, not something typed into the draft:
	// the URL IS the message, and MessageText draws it (#279, #878).
	let gifOpen = $state(false);
	async function sendGif(gif: Gif) {
		gifOpen = false;
		if (tooSoon()) return;
		sending = true;
		sendError = await deliver(gif.url, undefined, expiresIn || undefined);
		sending = false;
		if (!sendError) lastSentAt = Date.now();
	}
</script>

<div class="border-ink/5 @container relative shrink-0 border-t px-5 py-3">
	{#if gifOpen}
		<GifPicker
			onPick={(gif) => void sendGif(gif)}
			onClose={() => (gifOpen = false)}
		/>
	{/if}
	{#if sendError || error}
		<div class="mb-2">
			<Banner tone="error">{sendError ?? error}</Banner>
		</div>
	{/if}
	<ImageChip image={pending.current} onClear={pending.clear} />
	{#if timerLabel}
		<span
			class="bg-surface-raised text-muted mb-2 inline-flex items-center gap-1.5 rounded-full py-0.5 pr-1 pl-2.5 text-xs"
			><Timer size={12} class="text-neon" />Your lines disappear after {timerLabel}
			<button
				type="button"
				onclick={() => (expiresIn = 0)}
				class="icon-btn text-muted-dim hover:text-ink h-6 w-6"
				aria-label="turn the timer off"><X size={12} /></button
			></span
		>
	{/if}
	{#if mention}
		<ul
			id={listId}
			role="listbox"
			aria-label="people to mention"
			class="panel absolute bottom-full left-5 z-30 mb-1 min-w-44 p-1 shadow-2xl"
		>
			{#each mention.hits as name, i (name)}
				<li>
					<!-- mousedown is swallowed so the input keeps focus for the next word.
					     tabindex -1 and ids (#1962): the input is the combobox and names
					     the active option; the buttons are not stops of their own. -->
					<button
						type="button"
						id={optionId(i)}
						role="option"
						tabindex="-1"
						aria-selected={i === pick}
						onmousedown={(e) => e.preventDefault()}
						onclick={() => complete(name)}
						class="block w-full rounded px-3 py-2 text-left text-sm {i === pick
							? 'bg-surface-raised text-ink'
							: 'text-muted hover:text-ink'}">@{name}</button
					>
				</li>
			{/each}
		</ul>
	{/if}
	<form
		class="flex flex-wrap items-end gap-2"
		onsubmit={(e) => {
			e.preventDefault();
			void send();
		}}
	>
		{#if emojiOpen && emojiButton}
			<EmojiPicker
				anchor={emojiButton}
				{crewId}
				onPick={(key) => void insertEmoji(key)}
				onClose={() => (emojiOpen = false)}
			/>
		{/if}
		<input
			bind:this={filePicker}
			type="file"
			accept="image/*"
			class="hidden"
			onchange={(e) => {
				pending.pick(e.currentTarget.files?.[0]);
				e.currentTarget.value = '';
			}}
		/>
		<!-- The tools take a row of their own when the composer is narrow
		     (#2857): five 40 px buttons beside the box left it 72 px to type in
		     on a phone. The composer's own width decides, not the screen's — a
		     desk window with the sidebar open squeezes it the same way. -->
		<div class="flex items-end gap-2 @max-lg:basis-full">
			<!-- The kit's icon button, not a hand-typed one (#2170): these two sat
			     at 24 px under ux.md's 24 px floor, and only the attach one dimmed
			     when the box was locked, because each had typed its own skin. -->
			<button
				type="button"
				onclick={() => filePicker?.click()}
				disabled={!!lock}
				class="icon-btn text-muted hover:text-ink"
				aria-label="attach an image"
				title="attach an image (or paste one)"><ImageIcon size={16} /></button
			>
			<!-- Gated on the server having a Tenor key (ux.md): no button that
		     opens a picker with nothing behind it. -->
			{#if account.me?.gifsEnabled}
				<button
					type="button"
					onclick={() => (gifOpen = !gifOpen)}
					disabled={!!lock}
					data-gif-toggle
					class="icon-btn {gifOpen ? 'text-ink' : 'text-muted hover:text-ink'}"
					aria-label="send a GIF"
					aria-expanded={gifOpen}
					title="send a GIF"><ImagePlay size={16} /></button
				>
			{/if}
			<button
				type="button"
				bind:this={emojiButton}
				onclick={() => (emojiOpen = !emojiOpen)}
				disabled={!!lock}
				class="icon-btn {emojiOpen ? 'text-ink' : 'text-muted hover:text-ink'}"
				aria-label="add an emoji"
				aria-expanded={emojiOpen}
				title="add an emoji"><Smile size={16} /></button
			>
			{#if poke}
				<button
					type="button"
					onclick={poke.toggle}
					disabled={!!lock}
					class="icon-btn {poke.on ? 'text-neon' : 'text-muted hover:text-ink'}"
					aria-label="send as a poke"
					aria-pressed={poke.on}
					title={poke.on ? 'sends as a poke' : 'send as a poke'}
					><BellRing size={16} /></button
				>
			{/if}
			<button
				type="button"
				onclick={pickTimer}
				disabled={!!lock}
				class="icon-btn {expiresIn ? 'text-neon' : 'text-muted hover:text-ink'}"
				aria-label="make it temporary"
				aria-haspopup="menu"
				aria-pressed={!!expiresIn}
				title={timerLabel
					? `disappears after ${timerLabel}`
					: 'make it temporary'}><Timer size={16} /></button
			>
		</div>
		<!-- A textarea (#2642): a line break is something a rider writes, and a
		     long line wraps in view instead of sliding off the box's left edge. -->
		<textarea
			bind:this={composer}
			bind:value={draft}
			{@attach fitsText(() => draft)}
			rows="1"
			onpaste={pending.paste}
			onkeydown={onKey}
			role="combobox"
			aria-autocomplete="list"
			aria-expanded={!!mention}
			aria-controls={mention ? listId : undefined}
			aria-activedescendant={mention ? optionId(pick) : undefined}
			maxlength={MaxMessageChars}
			{placeholder}
			aria-label={placeholder}
			disabled={!!lock}
			class="input max-h-40 min-w-0 flex-1 resize-none"></textarea>
		<button
			disabled={!!lock || sending || (!draft.trim() && !pending.current)}
			class="btn btn-primary">Send</button
		>
	</form>
	<DraftEmoji text={draft} />
	{#if lock}
		<p class="text-muted mt-1.5 text-xs">{lock}</p>
	{:else if hint}
		<p class="text-muted-dim mt-1.5 text-[10px]">{hint}</p>
	{/if}
</div>
