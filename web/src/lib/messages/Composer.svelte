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
	import Banner from '$lib/components/Banner.svelte';
	import GifPicker from '$lib/chat/GifPicker.svelte';
	import type { Gif } from '$lib/chat/gifs';
	import ImageChip from '$lib/chat/ImageChip.svelte';
	import { createPendingImage } from '$lib/chat/pending-image.svelte';

	let {
		send: deliver,
		placeholder,
		hint,
		error = null,
	}: {
		/** Null when it went; the refusal to show when it did not. */
		send: (text: string, image?: Blob) => Promise<string | null>;
		placeholder: string;
		hint?: string;
		/** A banner unrelated to the last send attempt — the thread's own error. */
		error?: string | null;
	} = $props();

	let draft = $state('');
	let composer = $state<HTMLInputElement | null>(null);
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

	async function send() {
		const text = draft.trim();
		const image = pending.take();
		if (!text && !image) return;
		draft = '';
		sending = true;
		const refused = await deliver(text, image);
		sending = false;
		sendError = refused;
		if (refused) draft = text; // a refused message is not a deleted one
	}

	// A picked GIF is its own message, not something typed into the draft:
	// the URL IS the message, and MessageText draws it (#279, #878).
	let gifOpen = $state(false);
	async function sendGif(gif: Gif) {
		gifOpen = false;
		sending = true;
		sendError = await deliver(gif.url);
		sending = false;
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
			class="text-muted hover:text-ink rounded p-1"
			aria-label="attach an image"
			title="attach an image (or paste one)"><ImageIcon size={16} /></button
		>
		<!-- Gated on the server having a Tenor key (ux.md): no button that
		     opens a picker with nothing behind it. -->
		{#if account.me?.gifsEnabled}
			<button
				type="button"
				onclick={() => (gifOpen = !gifOpen)}
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
			maxlength="500"
			{placeholder}
			class="input min-w-0 flex-1"
		/>
		<button
			disabled={sending || (!draft.trim() && !pending.current)}
			class="btn btn-primary">Send</button
		>
	</form>
	{#if hint}
		<p class="text-muted/70 mt-1.5 text-[10px]">{hint}</p>
	{/if}
</div>
