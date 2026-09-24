<script lang="ts">
	// What a line says (#672 split for size in #2644): the words, or the
	// tombstone a taken-back DM leaves, the marks that say it was edited or
	// will disappear, and its picture. The row around it — the face, the
	// name, the reactions and the actions — stays MessageThread's.
	import BellRing from '@lucide/svelte/icons/bell-ring';
	import Timer from '@lucide/svelte/icons/timer';
	import ChatImage from '$lib/chat/ChatImage.svelte';
	import MessageText from '$lib/chat/MessageText.svelte';
	import type { MenuEntry } from '$lib/context-menu.svelte';
	import { formatLeft, formatStamp, formatTime } from '$lib/format';
	import type { ThreadMessage } from '$lib/messages/thread-types';

	let {
		message,
		mention,
		now,
		imageSrc,
		menu,
	}: {
		message: ThreadMessage;
		/** The line names the reader. */
		mention: boolean;
		/** The thread's clock, for what a temporary line has left. */
		now: number;
		imageSrc: (imageId: string) => string;
		menu: () => MenuEntry[];
	} = $props();
</script>

<!-- A line that names you gets the bar — there is no server
     mention yet, this is "@" plus your first name. -->
<span
	class="text-ink/85 block text-sm wrap-anywhere {mention
		? 'border-neon/60 bg-neon/5 -ml-2 rounded border-l-2 py-0.5 pl-2'
		: ''}"
>
	{#if message.deletedAt}
		<!-- A tombstone, DMs only (#2418): the row stays so
		     the other side is told at all, and there is
		     nothing left of the message but the fact that
		     something was here. Italic and muted, so it does
		     not read as somebody's words. -->
		<span class="text-muted text-sm italic">Message deleted</span>
	{:else}
		{#if message.poke}
			<!-- A poke (#2721) says who and when by being a line at all; this
			     says it was a poke, and whatever they added reads beneath. -->
			<span class="text-neon flex items-center gap-1.5 font-medium"
				><BellRing size={14} />{message.poke}</span
			>
		{/if}
		{#if message.text}
			<!-- Pre-wrap (#2642): a line break the rider typed is theirs to keep.
		     Their words only (#2686) — on the whole line it also kept this
		     template's own spaces, a blank row above every picture. -->
			<span class="whitespace-pre-wrap"
				><MessageText text={message.text} {menu} /></span
			>
		{/if}
	{/if}
	{#if message.editedAt}
		<!-- Nobody is rewritten quietly (#865). Not a
		     timestamp: WHEN it was fixed is nobody's
		     business, THAT it was is everybody's. -->
		<span
			class="text-muted-dim ml-1 align-baseline text-[10px]"
			title="edited {formatTime(message.editedAt)}">edited</span
		>
	{/if}
	{#if message.expiresAt}
		<!-- What a temporary line has left (#2644), on every line,
		     grouped or not — it is about this line, not the turn. -->
		<span
			class="text-muted-dim ml-1 inline-flex items-center gap-0.5 align-baseline text-[10px]"
			title="disappears {formatStamp(message.expiresAt)}"
			><Timer size={10} class="self-center" />{formatLeft(
				// The clock ticks at most once a minute; a line sent since has
				// had no time go by, whatever the clock last read.
				message.expiresAt - Math.max(now, message.at),
			)}</span
		>
	{/if}
	{#if message.imageId}
		<!-- The picture's own menu swallows the row's right-click
		     (#1817): hand the message's down, or a photo has no
		     react and no copy. -->
		<ChatImage
			src={imageSrc(message.imageId)}
			alt="Sent by {message.from}"
			{menu}
		/>
	{/if}
</span>
