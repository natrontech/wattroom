<script lang="ts">
	/**
	 * Rebind one clip's key: press the button, then press the key you want.
	 *
	 * Capture rather than a text field, because the question is "which key",
	 * not "which character" — and a field would need explaining what happens to
	 * Shift, to a dead key, to the space bar. Escape clears the binding, which
	 * is also how a rider says "no key at all".
	 */
	import { bindKey, type Clip } from '$lib/board/clips.svelte';

	let { clip }: { clip: Clip } = $props();

	let listening = $state(false);
	let refusal = $state<string | undefined>();

	async function capture(event: KeyboardEvent) {
		if (!listening) return;
		event.preventDefault();
		event.stopPropagation();
		if (event.key === 'Escape') {
			listening = false;
			refusal = await bindKey(clip.id, null).then((r) => r?.message);
			return;
		}
		// A modifier on its own is somebody still reaching for the real key.
		if (['Shift', 'Control', 'Alt', 'Meta'].includes(event.key)) return;
		if (event.key.length !== 1) {
			refusal =
				'That key cannot be a pad — pick a letter, a digit or a symbol.';
			return;
		}
		listening = false;
		refusal = await bindKey(clip.id, event.key).then((r) => r?.message);
	}
</script>

<svelte:window onkeydown={capture} />

<button
	onclick={() => {
		listening = !listening;
		refusal = undefined;
	}}
	aria-pressed={listening}
	title={listening
		? 'press a key — Escape to clear it'
		: clip.key
			? `fires on ${clip.key.toUpperCase()} — click to change`
			: 'no key — click to set one'}
	class="font-display h-8 w-14 shrink-0 rounded border text-[11px] uppercase {listening
		? 'border-neon text-ink'
		: 'border-muted/25 text-muted hover:border-muted/50'}"
>
	{#if listening}
		press…
	{:else if clip.key}
		{clip.key}
	{:else}
		—
	{/if}
</button>
{#if refusal}
	<span class="text-danger basis-full text-[11px]">{refusal}</span>
{/if}
