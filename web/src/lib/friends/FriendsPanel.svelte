<script lang="ts">
	import { goto } from '$app/navigation';
	import { levelFromXp } from '$lib/level';
	import Copy from '@lucide/svelte/icons/copy';
	import MessageCircle from '@lucide/svelte/icons/message-circle';
	import Radio from '@lucide/svelte/icons/radio';
	import UserX from '@lucide/svelte/icons/user-x';
	import { api } from '$lib/api';
	import { presence } from '$lib/presence.svelte';
	import { statusOf } from '$lib/status';
	import Avatar from '$lib/components/Avatar.svelte';
	import Banner from '$lib/components/Banner.svelte';
	import {
		contextMenu,
		MENU_HINT,
		type MenuEntry,
	} from '$lib/context-menu.svelte';
	import { dm } from '$lib/dm/dm.svelte';
	import { dmHeads } from '$lib/dm/heads.svelte';
	import { friends, type Friend } from '$lib/friends/friends.svelte';
	import { UNREAD_DOT } from '$lib/messages/unread-marks';
	import { personMenu } from '$lib/person-menu';
	import { toasts } from '$lib/toast.svelte';

	// The list, my code and its load error live in the store (#876): the app
	// refreshes it off the presence ping and announces what arrives in it,
	// whether or not this panel is on screen.
	const list = $derived(friends.list);
	let actionError = $state<string | null>(null);
	const error = $derived(actionError ?? friends.error);
	let codeInput = $state('');
	let codeError = $state<string | null>(null);

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
		await friends.reload();
	}

	async function act(
		path: string,
		method: 'POST' | 'DELETE',
		toast?: { message: string; undo?: () => void },
	) {
		const res = await api(path, { method });
		if (!res.ok) {
			actionError = res.error.message;
			return;
		}
		actionError = null;
		await friends.reload();
		if (toast) toasts.push(toast.message, { undo: toast.undo });
	}

	// Removal is silent and immediate (ADR-0012), so a mis-click gets an
	// undo toast rather than a confirm dialog (errors.md). The undo can only
	// re-send a request — acceptance needs the other side again — so it says
	// that rather than implying the friendship snaps straight back.
	async function undoRemove(id: string, name: string) {
		const res = await api('/api/friends', {
			method: 'POST',
			json: { userId: id },
		});
		if (!res.ok) {
			toasts.push(res.error.message, { tone: 'error' });
			return;
		}
		toasts.push(`Sent ${name} a new friend request.`);
		await friends.reload();
	}

	// A dismissal tells the other rider (ADR-0012 amendment) and sat one
	// 28 px button from Accept with no way back (#1652): undo over confirm.
	function dismiss(friend: Friend) {
		void act(`/api/friends/${friend.id}`, 'DELETE', {
			message: `Dismissed ${friend.name}'s request.`,
			undo: () => void act(`/api/friends/${friend.id}/restore`, 'POST'),
		});
	}

	function removeFriend(friend: Friend) {
		void act(`/api/friends/${friend.id}`, 'DELETE', {
			message: `Removed ${friend.name} as a friend.`,
			undo: () => void undoRemove(friend.id, friend.name),
		});
	}

	// Same person, same menu (person-menu.ts) — minus "Add friend", which
	// makes no sense on someone already friended, plus the two actions this
	// row alone offers: joining their room and ending the friendship (#663).
	function friendMenu(friend: Friend): MenuEntry[] {
		const entries: MenuEntry[] = personMenu(friend.id, goto).filter(
			(entry) => entry === 'separator' || entry.label !== 'Add friend',
		);
		entries.push('separator');
		if (friend.room)
			entries.push({
				label: 'Walk in',
				icon: Radio,
				onSelect: () => goto(`/r/${friend.room}`),
			});
		entries.push({
			label: 'Remove friend',
			icon: UserX,
			onSelect: () => removeFriend(friend),
			danger: true,
		});
		return entries;
	}

	const accepted = $derived(
		(list ?? []).filter((f) => f.status === 'accepted'),
	);
	// The two halves of "pending" mean opposite things and only one is
	// actionable (#1010): someone waiting on YOU goes first and loud, you
	// waiting on THEM goes last and quiet.
	const incoming = $derived(
		(list ?? []).filter((f) => f.status === 'pending_in'),
	);
	const outgoing = $derived(
		(list ?? []).filter((f) => f.status === 'pending_out'),
	);
</script>

<section class="mt-6">
	{#if list === null}
		{#if error}
			<!-- The list never arrived: the way back, not a red line over
			     "Loading…" for good (errors.md; audit 2026-09-09). -->
			<div class="mt-3">
				<Banner tone="error">
					{error}
					{#snippet action()}
						<button
							onclick={() => void friends.reload()}
							class="btn-link text-xs">Retry</button
						>
					{/snippet}
				</Banner>
			</div>
		{:else}
			<!-- errors.md: never blank while a fetch is in flight. -->
			<p class="text-muted mt-3 text-xs" aria-busy="true">Loading friends…</p>
		{/if}
	{:else}
		{#if error}
			<p class="text-danger mt-3 text-xs">{error}</p>
		{/if}
		<!-- Formation is code-only (ADR-0012 amendment): no user listing
		     exists — so this IS the way a friend is added, and it sat under the
		     whole list (#1017). A rider who came here to add someone scrolled
		     past everyone they already know to reach it, and on an empty list
		     it was the only control on the page and still last. -->
		<div class="mt-3 flex flex-wrap items-center gap-x-6 gap-y-3">
			{#if friends.code}
				<button
					onclick={() => {
						void navigator.clipboard.writeText(friends.code);
						toasts.push('Friend code copied.');
					}}
					class="text-muted hover:text-ink flex items-center gap-2 text-xs"
					title="copy your friend code"
				>
					your code
					<span class="font-display text-ink text-sm font-bold tracking-widest"
						>{friends.code}</span
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
			<p class="text-danger mt-2 text-xs">{codeError}</p>
		{/if}

		{#if list.length === 0}
			<!-- Nobody yet: teach the formation rule (ADR-0012 amendment). -->
			<p class="text-muted mt-3 text-sm">
				Friends are made by trading codes — share yours above, or enter theirs,
				to see when they're around.
			</p>
		{:else}
			{#if incoming.length > 0}
				<!-- Above the lists, because it is the only part of this page
				     that is waiting on you. Only the add-by-code row is higher
				     (#1017), and that is the thing a rider arrives here to
				     use — it is not a list of people to read past. -->
				<div class="eyebrow mt-3 px-1 pb-1">wants to be friends</div>
				<div class="panel">
					{#each incoming as friend (friend.id)}
						<div
							class="border-muted/10 flex items-center gap-3 border-b px-4 py-3 last:border-b-0"
						>
							<!-- Someone asking you gets a page: see who before you accept. -->
							<a
								href="/u/{friend.id}"
								class="text-sm font-medium hover:underline">{friend.name}</a
							>
							<span class="ml-auto flex shrink-0 items-center gap-3">
								<button
									onclick={() =>
										act(`/api/friends/${friend.id}/accept`, 'POST')}
									class="btn btn-primary btn-xs">Accept</button
								>
								<button
									onclick={() => dismiss(friend)}
									class="btn btn-ghost btn-xs">Dismiss</button
								>
							</span>
						</div>
					{/each}
				</div>
				<div class="eyebrow mt-4 px-1 pb-1">your friends</div>
			{/if}
			<div class="panel mt-3">
				{#each accepted as friend (friend.id)}
					<div
						class="border-muted/10 flex items-center gap-3 border-b px-4 py-3 last:border-b-0"
						title={MENU_HINT}
						{@attach contextMenu(() => friendMenu(friend))}
					>
						<!-- Slack's green dot (#251), now the avatar's own (#807):
						     online = app open (the lobby socket), with the room
						     named only for shared members. -->
						<Avatar
							name={friend.name}
							avatarUrl={friend.avatarUrl}
							xp={friend.totalXp}
							status={statusOf(presence.rooms, friend.id, friends.list)}
							ring="var(--color-surface-raised)"
							size={30}
						/>
						<span class="min-w-0">
							<span class="flex items-center gap-1.5 text-sm font-medium">
								<!-- Their page (ADR-0024): shared rides, medals, the month. -->
								<a href="/u/{friend.id}" class="hover:underline"
									>{friend.name}</a
								>
								<!-- Lifetime level is friend-visible identity (#253);
								     watts are not (ADR-0012). -->
								<span class="text-muted/70 text-[10px] font-normal"
									>lv {levelFromXp(friend.totalXp ?? 0)}</span
								>
							</span>
						</span>
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
								href="/messages/dm/{friend.id}"
								onclick={() => dm.show(friend.id, friend.name)}
								class="text-muted hover:text-ink relative"
								title="message {friend.name}"
								aria-label="message {friend.name}"
							>
								<MessageCircle size={15} />
								{#if dmHeads.unread(friend.id)}
									<span class="{UNREAD_DOT} absolute -top-0.5 -right-0.5"
									></span>
								{/if}
							</a>
							{#if friend.room}
								<a href="/r/{friend.room}" class="btn btn-primary btn-xs"
									>Walk in</a
								>
							{/if}
							<button
								onclick={() => removeFriend(friend)}
								class="btn btn-ghost btn-xs text-danger">Remove</button
							>
						</span>
					</div>
				{/each}
				{#each outgoing as friend (friend.id)}
					<div
						class="border-muted/10 text-muted flex items-center gap-3 border-b px-4 py-3 last:border-b-0"
					>
						<span class="text-sm">{friend.name}</span>
						<span class="text-xs">asked — waiting on them</span>
						<button
							onclick={() => act(`/api/friends/${friend.id}`, 'DELETE')}
							class="btn btn-ghost btn-xs ml-auto">Cancel</button
						>
					</div>
				{/each}
			</div>
		{/if}
	{/if}
</section>
