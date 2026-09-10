<script lang="ts">
	// The thread's composer (#468, #672): the draft, an attached or pasted
	// image, the GIF picker, and the send. Split out of MessageThread for
	// size; it owns the focus rule too — the box takes focus on navigation
	// and never from a control the rider chose.
	import ImageIcon from '@lucide/svelte/icons/image';
	import ImagePlay from '@lucide/svelte/icons/image-play';
	import { onMount, tick } from 'svelte';
	import { afterNavigate } from '$app/navigation';
	import { account } from '$lib/account.svelte';
	import { completeMention, mentionCompletion } from '$lib/messages/mention';
	import Banner from '$lib/components/Banner.svelte';
	import GifPicker from '$lib/chat/GifPicker.svelte';
	import type { Gif } from '$lib/chat/gifs';
	import ImageChip from '$lib/chat/ImageChip.svelte';
	import { createPendingImage } from '$lib/chat/pending-image.svelte';

	let {
		send: deliver,
		lineGapMs = 1000,
		placeholder,
		hint,
		error = null,
		lock = null,
		names = [],
	}: {
		/** Null when it went; the refusal to show when it did not. */
		send: (text: string, image?: Blob) => Promise<string | null>;
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
	} = $props();

	let draft = $state('');
	let composer = $state<HTMLInputElement | null>(null);

	// `@` completes over the thread's people (#1766). Escape puts the list
	// away for this draft; typing on brings it back.
	let dismissed = $state('');
	const mention = $derived(
		draft === dismissed ? null : mentionCompletion(draft, names),
	);
	let pick = $state(0);
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
		if (!mention) return;
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

	// The room's hub takes one line a second per rider and says so (#1762);
	// saying it here first keeps the draft and the picture in the box
	// instead of round-tripping a refusal for words already cleared. The
	// gap is the caller's (#1819): a DM has no such rule, and a GIF is a
	// line like any other.
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
		const refused = await deliver(text, image);
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

	// A picked GIF is its own message, not something typed into the draft:
	// the URL IS the message, and MessageText draws it (#279, #878).
	let gifOpen = $state(false);
	async function sendGif(gif: Gif) {
		gifOpen = false;
		if (tooSoon()) return;
		sending = true;
		sendError = await deliver(gif.url);
		sending = false;
		if (!sendError) lastSentAt = Date.now();
	}
</script>

<div class="border-ink/5 relative shrink-0 border-t px-5 py-3">
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
	{#if mention}
		<ul
			role="listbox"
			aria-label="people to mention"
			class="panel absolute bottom-full left-5 z-30 mb-1 min-w-44 p-1 shadow-2xl"
		>
			{#each mention.hits as name, i (name)}
				<li>
					<!-- mousedown is swallowed so the input keeps focus for the next word. -->
					<button
						type="button"
						role="option"
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
		class="flex items-center gap-2"
		onsubmit={(e) => {
			e.preventDefault();
			void send();
		}}
	>
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
		<button
			type="button"
			onclick={() => filePicker?.click()}
			disabled={!!lock}
			class="text-muted hover:text-ink rounded p-1 disabled:opacity-40"
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
				class="rounded p-1 {gifOpen ? 'text-ink' : 'text-muted hover:text-ink'}"
				aria-label="send a GIF"
				aria-expanded={gifOpen}
				title="send a GIF"><ImagePlay size={16} /></button
			>
		{/if}
		<input
			bind:this={composer}
			bind:value={draft}
			onpaste={pending.paste}
			onkeydown={onKey}
			aria-autocomplete="list"
			aria-expanded={!!mention}
			maxlength="500"
			{placeholder}
			aria-label={placeholder}
			disabled={!!lock}
			class="input min-w-0 flex-1"
		/>
		<button
			disabled={!!lock || sending || (!draft.trim() && !pending.current)}
			class="btn btn-primary">Send</button
		>
	</form>
	{#if lock}
		<p class="text-muted mt-1.5 text-xs">{lock}</p>
	{:else if hint}
		<p class="text-muted/70 mt-1.5 text-[10px]">{hint}</p>
	{/if}
</div>
