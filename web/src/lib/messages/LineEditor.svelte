<script lang="ts">
	// A sent line rewritten in place (#865): the line becomes its own box — no
	// modal for a typo, and the message stays where it is on screen while you
	// fix it. The thread mounts one at a time, so the draft lives here and dies
	// with the box; a second editor cannot leave a first one half-typed.
	import DraftEmoji from '$lib/chat/DraftEmoji.svelte';
	import { fitsText, sendsOnEnter } from '$lib/chat/textarea';
	import { MaxMessageChars } from '$lib/protocol';

	let {
		original,
		hint,
		save,
		onDone,
	}: {
		original: string;
		/** Who sees the edit land — a channel, or the one person a DM has (#1819). */
		hint: string;
		/** Resolves to the refusal, or null once the line has changed. */
		save: (text: string) => Promise<string | null>;
		onDone: () => void;
	} = $props();

	// svelte-ignore state_referenced_locally
	let draft = $state(original);
	let error = $state<string | null>(null);
	let saving = $state(false);

	async function submit() {
		const text = draft.trim();
		// Nothing changed is not an edit — closing is the honest answer, and
		// it spares the channel an edit that changed nothing.
		if (text === original.trim()) return onDone();
		if (!text) {
			error = 'An edited message still has to say something.';
			return;
		}
		saving = true;
		const refused = await save(text);
		saving = false;
		// A refusal keeps the words in the box, like a refused send.
		if (refused) error = refused;
		else onDone();
	}
</script>

<form
	class="mt-0.5"
	onsubmit={(e) => {
		e.preventDefault();
		void submit();
	}}
>
	<!-- svelte-ignore a11y_autofocus -->
	<textarea
		bind:value={draft}
		{@attach fitsText(() => draft)}
		rows="1"
		autofocus
		maxlength={MaxMessageChars}
		onkeydown={(e) => {
			if (e.key === 'Escape') onDone();
			else if (sendsOnEnter(e)) {
				e.preventDefault();
				void submit();
			}
		}}
		class="input max-h-60 w-full resize-none text-sm"
		aria-label="edit your message"></textarea>
	<DraftEmoji text={draft} />
	{#if error}
		<p class="text-danger mt-1 text-[11px]">{error}</p>
	{/if}
	<span class="mt-1 flex flex-wrap items-center gap-2">
		<button disabled={saving} class="btn btn-primary btn-xs">Save</button>
		<button type="button" onclick={onDone} class="btn btn-ghost btn-xs"
			>Cancel</button
		>
		<span class="text-muted-dim text-[10px]">{hint}</span>
	</span>
</form>
