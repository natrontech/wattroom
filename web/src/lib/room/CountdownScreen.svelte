<script lang="ts">
	import type { Snippet } from 'svelte';

	/**
	 * The count-in, on every riding surface (ADR-0046's parity rule, #1800).
	 * Built for the room's shared countdown and lifted out of the Training
	 * place when a solo ride got its own: one screen, so counting in looks the
	 * same whether ten people are waiting or nobody is.
	 *
	 * Read at three metres by someone already clipped in — one digit, nothing
	 * else moving. The digit is the only glowing thing on it (ADR-0005: live
	 * data glows, chrome does not).
	 */
	interface Props {
		/** Seconds left. */
		remaining: number;
		/** What is about to start — the workout's name. */
		title: string;
		/** One quiet line under the title: who is riding, or what is first up. */
		note?: string;
		/** Whatever can still be done about it — end it, cancel it. */
		controls?: Snippet;
	}
	let { remaining, title, note, controls }: Props = $props();
</script>

<div class="grid h-full place-items-center">
	<!-- Announced once (#1970): the start is the biggest state change in the
	     product, and a reader heard only the cue. The ticking digit is hidden
	     from it, or the whole block re-reads every second. -->
	<p class="sr-only" role="status">
		Starting {title || 'the session'} in a moment
	</p>
	<div class="text-center">
		<p class="eyebrow">starting</p>
		<p
			aria-hidden="true"
			class="font-display text-watt glow-text-strong text-[10rem] leading-none font-bold tabular-nums"
		>
			{remaining}
		</p>
		<p class="font-display mt-4 text-2xl font-bold">{title}</p>
		{#if note}
			<p class="text-muted mt-1 text-sm">{note}</p>
		{/if}
		{#if controls}
			<div class="mt-4 flex justify-center">{@render controls()}</div>
		{/if}
	</div>
</div>
