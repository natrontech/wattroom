<script lang="ts">
	import { MessageCircle } from '@lucide/svelte';
	import { api } from '$lib/api';
	import Avatar from '$lib/components/Avatar.svelte';
	import Select from '$lib/components/Select.svelte';
	import { dm } from '$lib/dm/dm.svelte';
	import { dmHeads } from '$lib/dm/heads.svelte';

	interface Friend {
		id: string;
		name: string;
		avatarUrl?: string;
		avatarPreset?: string;
		totalXp?: number;
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
		// Presence freshness matches the rail's poll cadence; DM heads are
		// polled globally (heads.svelte.ts), not by this panel.
		const timer = setInterval(() => void load(), 10_000);
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
			<div class="panel mt-3">
				{#each accepted as friend (friend.id)}
					<div
						class="border-muted/10 flex items-center gap-3 border-b px-4 py-3 last:border-b-0"
					>
						<span class="relative shrink-0">
							<Avatar
								name={friend.name}
								avatarUrl={friend.avatarUrl}
								preset={friend.avatarPreset}
								xp={friend.totalXp}
								size={30}
							/>
							<span
								class="border-surface-raised absolute -top-0.5 -left-0.5 h-2.5 w-2.5 rounded-full border-2 {friend.online
									? 'bg-z4'
									: 'bg-muted/40'}"
								title={friend.online ? 'in a room' : 'offline'}
							></span>
						</span>
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
									dmHeads.bump();
								}}
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
							</button>
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
