<script lang="ts">
	// The room's paperwork — invite, members, medals, settings — lives in a
	// drawer so the room itself can be the full-viewport app the design is.
	// Redesigned on #181 feedback: the invite is one copyable action, member
	// moderation is quiet until you reach for it.
	import { Check, Copy, Crown, ShieldBan } from '@lucide/svelte';
	import { api } from '$lib/api';
	import { toasts } from '$lib/toast.svelte';

	interface Member {
		id: string;
		displayName: string;
		role: string;
	}
	interface Medal {
		kind: string;
		rider: string;
		awardedAt: string;
	}

	let {
		open = $bindable(false),
		slug,
		code = '',
		members = [],
		medals = [],
		isOwner,
		myId,
		streakWeeks = 0,
		monthKj = 0,
		busy = false,
		onRole,
		onRemove,
	}: {
		open?: boolean;
		slug: string;
		code?: string;
		members?: Member[];
		medals?: Medal[];
		isOwner: boolean;
		myId?: string;
		streakWeeks?: number;
		monthKj?: number;
		busy?: boolean;
		onRole: (userId: string, role: string) => void;
		onRemove: (userId: string) => void;
	} = $props();

	const MEDAL_BADGE: Record<string, string> = {
		diesel: '🛢️ Diesel',
		metronome: '🎯 Metronome',
		hammer: '🔨 Hammer',
		lanterne_rouge: '🏮 Lanterne Rouge',
	};

	const inviteUrl = $derived(`${location.origin}/r/${slug}`);
	let copied = $state(false);
	async function copyInvite() {
		try {
			await navigator.clipboard.writeText(inviteUrl);
			copied = true;
			setTimeout(() => (copied = false), 2000);
		} catch {
			toasts.push('Could not copy — select the link instead.', {
				tone: 'error',
			});
		}
	}

	// Friends you could pull in: accepted, not already members. The invite is
	// a DM carrying the room link — the friendship gate is the permission.
	interface FriendRow {
		id: string;
		name: string;
		status: string;
	}
	let invitable = $state<FriendRow[]>([]);
	let invited = $state<string[]>([]);
	$effect(() => {
		if (!open) return;
		void api<{ friends: FriendRow[] }>('/api/friends').then((res) => {
			if (!res.ok) return;
			invitable = res.data.friends.filter(
				(f) => f.status === 'accepted' && !members.some((m) => m.id === f.id),
			);
		});
	});
	async function invite(friend: FriendRow) {
		const res = await api(`/api/dms/${friend.id}`, {
			method: 'POST',
			json: { text: `Come ride with me: ${inviteUrl}` },
		});
		if (!res.ok) {
			toasts.push(res.error.message, { tone: 'error' });
			return;
		}
		invited.push(friend.id);
	}

	// Banned members sink to the bottom; the owner sees them, nobody else does.
	const shown = $derived(
		[...members].sort(
			(a, b) =>
				Number(a.role === 'banned') - Number(b.role === 'banned') ||
				Number(b.role === 'owner') - Number(a.role === 'owner'),
		),
	);
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && (open = false)} />

{#if open}
	<button
		class="bg-paper/50 fixed inset-0 z-40"
		aria-label="Close room settings"
		onclick={() => (open = false)}
	></button>
	<aside
		class="bg-surface border-ink/10 fixed inset-y-0 right-0 z-50 flex w-96 max-w-full flex-col overflow-y-auto border-l p-5"
	>
		<div class="flex items-center justify-between">
			<h2 class="font-display text-lg font-bold">Room</h2>
			<button
				onclick={() => (open = false)}
				class="text-muted hover:text-ink text-sm">close (esc)</button
			>
		</div>

		<!-- Getting someone in is the drawer's number-one job: one action. -->
		<div class="panel mt-5 px-4 py-3.5">
			<span class="eyebrow">invite riders</span>
			<div class="mt-2 flex items-center gap-2">
				<span class="min-w-0 flex-1 truncate font-mono text-xs select-all"
					>{inviteUrl}</span
				>
				<button
					onclick={copyInvite}
					class="btn btn-secondary btn-xs shrink-0"
					aria-label="copy invite link"
				>
					{#if copied}<Check size={12} /> Copied{:else}<Copy size={12} /> Copy{/if}
				</button>
			</div>
			{#if code}
				<p class="text-muted mt-2 text-xs">
					or the code
					<span class="text-ink font-mono text-sm tracking-[0.25em] select-all"
						>{code}</span
					>
				</p>
			{/if}
			{#if invitable.length > 0}
				<div class="border-ink/5 mt-3 border-t pt-2.5">
					<span class="eyebrow">or DM a friend the link</span>
					<ul class="mt-1.5 space-y-1.5">
						{#each invitable as friend (friend.id)}
							<li class="flex items-center gap-2 text-xs">
								<span class="min-w-0 truncate">{friend.name}</span>
								{#if invited.includes(friend.id)}
									<span class="text-muted ml-auto flex items-center gap-1">
										<Check size={12} /> invited
									</span>
								{:else}
									<button
										onclick={() => void invite(friend)}
										class="btn btn-secondary btn-xs ml-auto">Invite</button
									>
								{/if}
							</li>
						{/each}
					</ul>
				</div>
			{/if}
			<a
				href="/r/{slug}/watch"
				class="text-muted hover:text-ink mt-2 inline-block text-xs underline"
				>Watch on a phone (read-only)</a
			>
		</div>

		{#if streakWeeks > 0 || monthKj > 0}
			<div class="mt-5 flex gap-2">
				<div class="border-muted/15 flex-1 rounded-lg border px-3 py-2">
					<p class="font-display text-lg leading-tight font-bold tabular-nums">
						{streakWeeks}<span class="text-muted ml-1 text-xs">wk</span>
					</p>
					<p class="eyebrow">crew streak</p>
				</div>
				<div class="border-muted/15 flex-1 rounded-lg border px-3 py-2">
					<p class="font-display text-lg leading-tight font-bold tabular-nums">
						{(monthKj / 1000).toFixed(1)}<span class="text-muted ml-1 text-xs"
							>MJ</span
						>
					</p>
					<p class="eyebrow">this month</p>
				</div>
			</div>
		{/if}

		<div class="mt-6">
			<span class="eyebrow">members · {members.length}</span>
			<ul class="divide-ink/5 mt-1 divide-y">
				{#each shown as member (member.id)}
					<li class="flex items-center gap-2 py-2.5">
						<span
							class="min-w-0 truncate text-sm font-medium {member.role ===
							'banned'
								? 'text-muted line-through'
								: ''}">{member.displayName}</span
						>
						{#if member.role === 'owner'}
							<Crown size={12} class="text-muted shrink-0" />
							<span class="eyebrow">owner</span>
						{:else if member.role === 'coach'}
							<span class="eyebrow">coach</span>
						{:else if member.role === 'banned'}
							<ShieldBan size={12} class="text-muted shrink-0" />
							<span class="eyebrow">banned</span>
						{/if}
						{#if isOwner && member.role === 'banned'}
							<button
								onclick={() => onRole(member.id, 'member')}
								disabled={busy}
								class="btn btn-secondary btn-xs ml-auto">Unban</button
							>
						{:else if isOwner && member.role !== 'owner'}
							<!-- Quiet until reached for: moderation is rare, the list
							     is read daily. Ban/remove live behind the settings page
							     too — here they are one tap for the mid-ride case. -->
							<span
								class="text-muted ml-auto flex shrink-0 items-center gap-2.5 text-[11px]"
							>
								<button
									onclick={() =>
										onRole(
											member.id,
											member.role === 'coach' ? 'member' : 'coach',
										)}
									disabled={busy}
									class="hover:text-ink underline disabled:opacity-40"
									>{member.role === 'coach' ? 'demote' : 'make coach'}</button
								>
								<button
									onclick={() => onRemove(member.id)}
									disabled={busy}
									class="hover:text-z6 underline disabled:opacity-40"
									>remove</button
								>
								<button
									onclick={() => onRole(member.id, 'banned')}
									disabled={busy}
									class="hover:text-z6 underline disabled:opacity-40"
									>ban</button
								>
							</span>
						{/if}
					</li>
				{/each}
			</ul>
		</div>

		{#if medals.length > 0}
			<div class="mt-6">
				<span class="eyebrow">medals</span>
				<ul class="mt-2 flex flex-wrap gap-2">
					{#each medals as medal, i (i)}
						<li
							class="border-muted/15 bg-surface-raised rounded-full border px-3 py-1.5 text-xs"
						>
							{MEDAL_BADGE[medal.kind] ?? medal.kind} · {medal.rider}
							<span class="text-muted">· {medal.awardedAt}</span>
						</li>
					{/each}
				</ul>
			</div>
		{/if}

		<div class="border-ink/5 mt-auto border-t pt-4">
			{#if isOwner}
				<a href="/r/{slug}/settings" class="btn btn-secondary"
					>Room settings — name, icon, sounds, reactions</a
				>
			{:else if myId}
				<button
					onclick={() => onRemove(myId)}
					disabled={busy}
					class="text-muted hover:text-ink text-xs underline disabled:opacity-40"
					>Leave this room</button
				>
			{/if}
		</div>
	</aside>
{/if}
