<script lang="ts">
	import RidingBars from '$lib/components/RidingBars.svelte';
	import { Copy, MessageCircle } from '@lucide/svelte';
	import { api } from '$lib/api';
	import Avatar from '$lib/components/Avatar.svelte';
	import { dm } from '$lib/dm/dm.svelte';
	import { dmHeads } from '$lib/dm/heads.svelte';
	import { presence } from '$lib/presence.svelte';
	import { toasts } from '$lib/toast.svelte';

	interface Friend {
		id: string;
		name: string;
		avatarUrl?: string;
		avatarPreset?: string;
		totalXp?: number;
		status: 'accepted' | 'pending_in' | 'pending_out';
		online?: boolean;
		inRoom?: boolean;
		room?: string;
		roomName?: string;
	}

	let friends = $state<Friend[] | null>(null);
	let myCode = $state('');
	let error = $state<string | null>(null);
	let codeInput = $state('');
	let codeError = $state<string | null>(null);
	async function load() {
		const res = await api<{ friends: Friend[]; code: string }>('/api/friends');
		if (!res.ok) {
			error = res.error.message;
			return;
		}
		error = null;
		friends = res.data.friends;
		myCode = res.data.code;
	}

	async function addByCode(event: SubmitEvent) {
		event.preventDefault();
		const res = await api('/api/friends', {
			method: 'POST',
			json: { code: codeInput },
		});
		if (!res.ok) {
			codeError = res.error.message;
			return;
		}
		codeError = null;
		codeInput = '';
		await load();
	}

	$effect(() => {
		// Push-driven (#251): any presence change — a friend coming online, a
		// join, a leave — bumps the version and this re-fetches. DM heads are
		// polled globally (heads.svelte.ts), not by this panel.
		presence.version;
		void load();
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

<section class="mt-6">
	{#if error}
		<p class="text-z6 mt-3 text-xs">{error}</p>
	{/if}

	{#if friends !== null}
		{#if friends.length === 0}
			<!-- Nobody yet: teach the formation rule (ADR-0012 amendment). -->
			<p class="text-muted mt-3 text-sm">
				Friends are made by trading codes — share yours below, or enter theirs,
				to see when they're around.
			</p>
		{:else}
			<div class="panel mt-3">
				{#each accepted as friend (friend.id)}
					<div
						class="border-muted/10 flex items-center gap-3 border-b px-4 py-3 last:border-b-0"
					>
						<!-- Slack's green dot (#251): online = app open (the lobby
						     socket), with the room named only for shared members. -->
						<span class="relative shrink-0">
							<Avatar
								name={friend.name}
								avatarUrl={friend.avatarUrl}
								preset={friend.avatarPreset}
								xp={friend.totalXp}
								size={30}
							/>
							{#if friend.inRoom}
								<span
									class="bg-surface-raised ring-surface-raised absolute -top-1 -left-1 rounded-full px-0.5 py-px ring-2"
								>
									<RidingBars size={8} />
								</span>
							{:else}
								<span
									class="border-surface-raised absolute -top-0.5 -left-0.5 h-2.5 w-2.5 rounded-full border-2 {friend.online
										? 'bg-z4'
										: 'bg-muted/40'}"
									title={friend.online ? 'online' : 'offline'}
								></span>
							{/if}
						</span>
						<span class="text-sm font-medium">{friend.name}</span>
						<span class="text-muted min-w-0 truncate text-xs">
							{#if friend.roomName}
								in {friend.roomName}
							{:else if friend.inRoom}
								in a room
							{:else if friend.online}
								online
							{/if}
						</span>
						<span class="ml-auto flex shrink-0 items-center gap-3">
							<a
								href="/dm/{friend.id}"
								onclick={() => dm.show(friend.id, friend.name)}
								class="text-muted hover:text-ink relative"
								title="message {friend.name}"
								aria-label="message {friend.name}"
							>
								<MessageCircle size={15} />
								{#if dmHeads.unread(friend.id)}
									<span
										class="bg-watt absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full"
									></span>
								{/if}
							</a>
							{#if friend.room}
								<a href="/r/{friend.room}" class="btn btn-primary btn-xs"
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
									class="btn btn-primary btn-xs">Accept</button
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

		<!-- Formation is code-only (ADR-0012 amendment): no user listing exists. -->
		<div class="mt-4 flex flex-wrap items-center gap-x-6 gap-y-3">
			{#if myCode}
				<button
					onclick={() => {
						void navigator.clipboard.writeText(myCode);
						toasts.push('Friend code copied.');
					}}
					class="text-muted hover:text-ink flex items-center gap-2 text-xs"
					title="copy your friend code"
				>
					your code
					<span class="font-display text-ink text-sm font-bold tracking-widest"
						>{myCode}</span
					>
					<Copy size={13} />
				</button>
			{/if}
			<form onsubmit={addByCode} class="flex items-center gap-2">
				<input
					bind:value={codeInput}
					class="input w-36 uppercase"
					placeholder="friend code"
					maxlength="8"
					aria-label="add a friend by code"
				/>
				<button class="btn btn-xs" disabled={!codeInput.trim()}>Add</button>
			</form>
		</div>
		{#if codeError}
			<p class="text-z6 mt-2 text-xs">{codeError}</p>
		{/if}
	{/if}
</section>
