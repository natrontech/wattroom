<script lang="ts">
	import { X } from '@lucide/svelte';
	import { api } from '$lib/api';
	import MessageText from '$lib/chat/MessageText.svelte';
	import { dm } from '$lib/dm/dm.svelte';
	import { roomConnection } from '$lib/room/connection.svelte';

	// The DM drawer (#208): one thread, bottom-right, polled — a note between
	// rides, not a live wire (ADR-0012 amended).
	interface Message {
		id: string;
		mine: boolean;
		text: string;
		at: number;
	}

	let messages = $state<Message[]>([]);
	let draft = $state('');
	let error = $state<string | null>(null);
	let list = $state<HTMLDivElement | null>(null);

	async function load(peerId: string, after: number) {
		const res = await api<{ messages: Message[] }>(
			`/api/dms/${peerId}${after ? `?after=${after}` : ''}`,
		);
		if (!res.ok) {
			error = res.error.message;
			return;
		}
		error = null;
		// `after` is millisecond-truncated, so the boundary message can come
		// back — merge by id, never blind-append.
		const seen = new Set(messages.map((m) => m.id));
		const fresh = res.data.messages.filter((m) => !seen.has(m.id));
		if (!after) {
			messages = res.data.messages;
		} else if (fresh.length > 0) {
			messages = [...messages, ...fresh];
		}
		if (messages.length > 0 && (fresh.length > 0 || !after)) {
			// "Seen" only when you could actually have seen it — a drawer left
			// open in a hidden tab must keep the badge (audit #219).
			if (!document.hidden) dm.stampSeen(peerId);
			queueMicrotask(() => list?.scrollTo({ top: list.scrollHeight }));
		}
	}

	$effect(() => {
		const peer = dm.open;
		messages = [];
		if (!peer) return;
		void load(peer.id, 0);
		const timer = setInterval(
			() => void load(peer.id, messages.at(-1)?.at ?? 0),
			5_000,
		);
		return () => clearInterval(timer);
	});

	async function send() {
		const peer = dm.open;
		const text = draft.trim();
		if (!peer || !text) return;
		draft = '';
		const res = await api(`/api/dms/${peer.id}`, {
			method: 'POST',
			json: { text },
		});
		if (!res.ok) {
			error = res.error.message;
			draft = text; // a refused message is not a deleted one
			return;
		}
		await load(peer.id, messages.at(-1)?.at ?? 0);
	}
</script>

{#if dm.open}
	<div
		class="bg-surface-raised ring-ink/15 fixed bottom-4 z-50 flex h-96 w-80 flex-col rounded-lg shadow-lg ring-1 {roomConnection
			.current?.live.tick?.jukebox?.current
			? 'right-[392px]'
			: 'right-4'}"
		role="dialog"
		aria-label="messages with {dm.open.name}"
	>
		<div class="border-ink/5 flex items-center gap-2 border-b px-3 py-2">
			<span class="truncate text-sm font-medium">{dm.open.name}</span>
			<button
				onclick={() => dm.close()}
				class="text-muted hover:text-ink ml-auto"
				aria-label="close messages"><X size={14} /></button
			>
		</div>
		<div
			bind:this={list}
			class="min-h-0 flex-1 space-y-1.5 overflow-x-hidden overflow-y-auto p-3"
		>
			{#each messages as message (message.id)}
				<div class="flex {message.mine ? 'justify-end' : ''}">
					<span
						class="max-w-[85%] rounded-lg px-2.5 py-1.5 text-xs leading-snug wrap-anywhere {message.mine
							? 'bg-neon/20'
							: 'bg-surface'}"
					>
						<MessageText text={message.text} />
					</span>
				</div>
			{:else}
				<p class="text-muted/60 text-xs">
					Just you two — messages stay between friends, last 500 kept.
				</p>
			{/each}
			{#if error}<p class="text-z6 text-xs">{error}</p>{/if}
		</div>
		<form
			class="border-ink/5 flex gap-1.5 border-t p-2"
			onsubmit={(e) => {
				e.preventDefault();
				void send();
			}}
		>
			<input
				bind:value={draft}
				maxlength="500"
				placeholder="Message {dm.open.name}…"
				class="input input-xs min-w-0 flex-1"
			/>
			<button disabled={!draft.trim()} class="btn btn-primary btn-xs"
				>Send</button
			>
		</form>
	</div>
{/if}
