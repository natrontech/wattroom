<script lang="ts">
	import { MessageCircle } from '@lucide/svelte';
	import { api } from '$lib/api';
	import Select from '$lib/components/Select.svelte';
	import { dm } from '$lib/dm/dm.svelte';
	import { notify } from '$lib/notify.svelte';
	import { play } from '$lib/sound/cues';

	interface Friend {
		id: string;
		name: string;
		status: 'accepted' | 'pending_in' | 'pending_out';
		online?: boolean;
		room?: string;
		roomName?: string;
	}
	interface Candidate {
		id: string;
		name: string;
	}

	let friends = $state<Friend[] | null>(null);
	let candidates = $state<Candidate[]>([]);
	let error = $state<string | null>(null);
	let picked = $state('');
	interface Head {
		peerId: string;
		peerName: string;
		text: string;
		mine: boolean;
		at: number;
	}
	// peerId → newest inbound message time — the unread badge's raw material.
	let inbound = $state<Record<string, number>>({});
	let heads = $state<Head[]>([]);
	let seenBump = $state(0);

	async function loadHeads(first: boolean) {
		const res = await api<{
			conversations: {
				peerId: string;
				peerName: string;
				text: string;
				mine: boolean;
				at: number;
			}[];
		}>('/api/dms');
		if (!res.ok) return;
		heads = [...res.data.conversations].sort((a, b) => b.at - a.at);
		const next: Record<string, number> = {};
		for (const head of res.data.conversations) {
			if (head.mine) continue;
			next[head.peerId] = head.at;
			// A NEW inbound line (not on first load): blip + hidden-tab alert,
			// unless that thread is open right now.
			if (
				!first &&
				head.at > (inbound[head.peerId] ?? 0) &&
				dm.open?.id !== head.peerId
			) {
				play('chat');
				notify.push(head.peerName, head.text, `dm-${head.peerId}`);
			}
		}
		inbound = next;
	}

	function unread(peerId: string): boolean {
		void seenBump; // re-check after opening a thread stamps it seen
		return (inbound[peerId] ?? 0) > dm.seenAt(peerId);
	}

	async function load() {
		const res = await api<{ friends: Friend[]; candidates: Candidate[] }>(
			'/api/friends',
		);
		if (!res.ok) {
			error = res.error.message;
			return;
		}
		error = null;
		friends = res.data.friends;
		candidates = res.data.candidates;
	}

	$effect(() => {
		void load();
		void loadHeads(true);
		// Presence freshness matches the rail's poll cadence.
		const timer = setInterval(() => {
			void load();
			void loadHeads(false);
		}, 10_000);
		return () => clearInterval(timer);
	});

	async function act(path: string, method: 'POST' | 'DELETE') {
		const res = await api(path, { method });
		if (!res.ok) error = res.error.message;
		await load();
	}

	const accepted = $derived(
		(friends ?? []).filter((f) => f.status === 'accepted'),
	);
	const pending = $derived(
		(friends ?? []).filter((f) => f.status !== 'accepted'),
	);
</script>

<section class="mt-10">
	<h2 class="text-muted text-xs font-semibold tracking-widest uppercase">
		Friends
	</h2>

	{#if error}
		<p class="text-z6 mt-3 text-xs">{error}</p>
	{/if}

	{#if friends !== null}
		{#if friends.length === 0 && candidates.length === 0}
			<!-- Nobody to add yet: teach the formation rule (ADR-0012). -->
			<p class="text-muted mt-3 text-sm">
				Friends are made in rooms — ride with someone first, then add them here
				to see when they're around.
			</p>
		{:else}
			<div class="border-muted/15 bg-surface-raised mt-3 rounded-lg border">
				{#each accepted as friend (friend.id)}
					<div
						class="border-muted/10 flex items-center gap-3 border-b px-4 py-3 last:border-b-0"
					>
						<span
							class="h-2 w-2 shrink-0 rounded-full {friend.online
								? 'bg-z4'
								: 'bg-muted/40'}"
							title={friend.online ? 'in a room' : 'offline'}
						></span>
						<span class="text-sm font-medium">{friend.name}</span>
						<span class="text-muted min-w-0 truncate text-xs">
							{#if friend.roomName}
								in {friend.roomName}
							{:else if friend.online}
								riding elsewhere
							{/if}
						</span>
						<span class="ml-auto flex shrink-0 items-center gap-3">
							<button
								onclick={() => {
									dm.show(friend.id, friend.name);
									seenBump += 1;
								}}
								class="text-muted hover:text-ink relative"
								title="message {friend.name}"
								aria-label="message {friend.name}"
							>
								<MessageCircle size={15} />
								{#if unread(friend.id)}
									<span
										class="bg-watt absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full"
									></span>
								{/if}
							</button>
							{#if friend.room}
								<a
									href="/r/{friend.room}"
									class="bg-ink text-paper hover:bg-ink/90 rounded px-3 py-1.5 text-xs font-semibold"
									>Join them</a
								>
							{/if}
							<button
								onclick={() => act(`/api/friends/${friend.id}`, 'DELETE')}
								class="text-muted hover:text-ink text-xs">remove</button
							>
						</span>
					</div>
				{/each}
				{#each pending as friend (friend.id)}
					<div
						class="border-muted/10 flex items-center gap-3 border-b px-4 py-3 last:border-b-0"
					>
						<span class="text-sm font-medium">{friend.name}</span>
						{#if friend.status === 'pending_in'}
							<span class="text-muted text-xs">wants to be friends</span>
							<span class="ml-auto flex shrink-0 items-center gap-3">
								<button
									onclick={() =>
										act(`/api/friends/${friend.id}/accept`, 'POST')}
									class="bg-ink text-paper hover:bg-ink/90 rounded px-3 py-1.5 text-xs font-semibold"
									>Accept</button
								>
								<button
									onclick={() => act(`/api/friends/${friend.id}`, 'DELETE')}
									class="text-muted hover:text-ink text-xs">dismiss</button
								>
							</span>
						{:else}
							<span class="text-muted text-xs">asked — waiting on them</span>
							<button
								onclick={() => act(`/api/friends/${friend.id}`, 'DELETE')}
								class="text-muted hover:text-ink ml-auto text-xs">cancel</button
							>
						{/if}
					</div>
				{/each}
			</div>
		{/if}

		{#if heads.length > 0}
			<!-- Your conversations (#208): the DM history's front door. -->
			<h3 class="text-muted mt-6 text-[10px] tracking-[0.2em] uppercase">
				messages
			</h3>
			<div class="border-muted/15 bg-surface-raised mt-2 rounded-lg border">
				{#each heads as head (head.peerId)}
					<button
						onclick={() => {
							dm.show(head.peerId, head.peerName);
							seenBump += 1;
						}}
						class="border-ink/5 hover:bg-surface flex w-full items-center gap-3 border-b px-4 py-2.5 text-left transition-colors last:border-b-0"
					>
						<span class="relative shrink-0">
							<MessageCircle size={15} class="text-muted" />
							{#if unread(head.peerId)}
								<span
									class="bg-watt absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full"
								></span>
							{/if}
						</span>
						<span class="min-w-0">
							<span class="block truncate text-xs font-medium"
								>{head.peerName}</span
							>
							<span class="text-muted block truncate text-[11px]"
								>{head.mine ? 'you: ' : ''}{head.text}</span
							>
						</span>
						<span class="text-muted/60 ml-auto shrink-0 text-[10px]">
							{new Date(head.at).toLocaleTimeString(undefined, {
								hour: '2-digit',
								minute: '2-digit',
							})}
						</span>
					</button>
				{/each}
			</div>
		{/if}

		{#if candidates.length > 0}
			<div class="mt-3 max-w-xs">
				<Select
					label="Add a friend"
					options={[
						{ value: '', label: 'Add a friend…' },
						...candidates.map((c) => ({ value: c.id, label: c.name })),
					]}
					bind:value={picked}
					onchange={(id) => {
						if (!id) return;
						picked = '';
						void act(`/api/friends/${id}`, 'POST');
					}}
				/>
			</div>
		{/if}
	{/if}
</section>
