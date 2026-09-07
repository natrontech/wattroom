<script lang="ts">
	/**
	 * Rebind the chord that shows and hides the board (#982).
	 *
	 * The same capture-then-press shape as `KeyBinder`, for the same reason:
	 * the question is "which key", not "which character". It listens in the
	 * CAPTURE phase, so the chord being pressed reaches this and nothing else —
	 * the board's own window handler runs on the bubble and would otherwise
	 * toggle the panel while the rider was busy choosing the key that toggles
	 * the panel.
	 *
	 * Escape cancels rather than clearing: there is no "no chord" state to
	 * offer — the board would have no keyboard at all — so Reset is what
	 * undoes a choice.
	 */
	import { RotateCcw } from '@lucide/svelte';
	import {
		chordLabel,
		DEFAULT_CHORD,
		toggleKey,
	} from '$lib/board/toggle-key.svelte';

	const fallback = chordLabel(DEFAULT_CHORD);

	let listening = $state(false);
	let refusal = $state<string | undefined>();

	function capture(event: KeyboardEvent) {
		if (!listening) return;
		event.preventDefault();
		event.stopPropagation();
		if (event.key === 'Escape') {
			listening = false;
			refusal = undefined;
			return;
		}
		// A modifier on its own is somebody still reaching for the real key.
		if (['Shift', 'Control', 'Alt', 'Meta'].includes(event.key)) return;
		// A refused chord keeps it listening: the rider is mid-choice and the
		// message says what to try instead.
		refusal =
			toggleKey.set({
				code: event.code,
				alt: event.altKey,
				ctrl: event.ctrlKey,
				shift: event.shiftKey,
				meta: event.metaKey,
			}) ?? undefined;
		if (!refusal) listening = false;
	}
</script>

<svelte:window onkeydowncapture={capture} />

<div class="mt-3 flex flex-wrap items-center gap-2">
	<span class="text-muted text-[11px]">shows and hides the board</span>
	<button
		onclick={() => {
			listening = !listening;
			refusal = undefined;
		}}
		aria-pressed={listening}
		title={listening
			? 'press a chord — Escape to cancel'
			: `${toggleKey.label} — click to change`}
		class="font-display ml-auto h-8 shrink-0 rounded border px-2 text-[11px] {listening
			? 'border-neon text-ink'
			: 'border-muted/25 text-muted hover:border-muted/50'}"
	>
		{listening ? 'press a chord…' : toggleKey.label}
	</button>
	<button
		onclick={() => {
			toggleKey.reset();
			listening = false;
			refusal = undefined;
		}}
		disabled={toggleKey.label === fallback}
		title="back to {fallback}"
		aria-label="reset the chord to {fallback}"
		class="text-muted hover:text-ink grid h-8 w-8 shrink-0 place-items-center rounded disabled:opacity-30"
		><RotateCcw size={13} /></button
	>
	{#if refusal}
		<span class="text-danger basis-full text-[11px]">{refusal}</span>
	{/if}
</div>
