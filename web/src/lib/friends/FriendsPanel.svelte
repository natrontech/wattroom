<script lang="ts">
	import { goto } from '$app/navigation';
	import type { Snippet } from 'svelte';
	import { levelFromXp } from '$lib/level';
	import Copy from '@lucide/svelte/icons/copy';
	import MessageCircle from '@lucide/svelte/icons/message-circle';
	import Radio from '@lucide/svelte/icons/radio';
	import UserX from '@lucide/svelte/icons/user-x';
	import { api } from '$lib/api';
	import { statusOf } from '$lib/status';
	import { crewLive } from '$lib/nav/crew-live.svelte';
	import Avatar from '$lib/components/Avatar.svelte';
	import Banner from '$lib/components/Banner.svelte';
	import {
		contextMenu,
		MENU_HINT,
		type MenuEntry,
	} from '$lib/context-menu.svelte';
	import { dm } from '$lib/dm/dm.svelte';
	import { dmHeads } from '$lib/dm/heads.svelte';
	import {
		acceptRequest,
		dismissRequest,
		removeFriend,
		withdrawRequest,
	} from '$lib/friends/actions';
	import {
		friendPlace,
		friends,
		type Friend,
	} from '$lib/friends/friends.svelte';
	import { copyText } from '$lib/copy';
	import { FriendCodeLen } from '$lib/protocol';
	import { UNREAD_DOT } from '$lib/messages/unread-marks';
	import { personMenu } from '$lib/person-menu';
	import { toasts } from '$lib/toast.svelte';

	// The list, my code and its load error live in the store (#876): the app
	// refreshes it off the presence ping and announces what arrives in it,
	// whether or not this panel is on screen.
	const list = $derived(friends.list);
	const error = $derived(friends.error);
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

	// The acts themselves live beside the store (#2172): the rider page
	// offers the same person the same answers, and a refusal reads the same
	// wherever it was started from — a toast, which is what the result of a
	// background action is (errors.md). It used to be a red line above the
	// code box at the top of the page, nowhere near the row that refused,
	// and it stayed there until the next act succeeded (#2182).
	async function run(act: Promise<string | null>) {
		const message = await act;
		if (message) toasts.push(message, { tone: 'error' });
	}

	// Same person, same menu (person-menu.ts), plus the two actions this row
	// alone offers: joining their room and the way out of whatever standing
	// they are in (#663, #2172) — which is not always "Remove friend": a row
	// that offered that for a request nobody had accepted named an act that
	// does not exist. "Add friend" is left out by the menu itself now that it
	// is told the standing — this row used to filter it out by label, and the
	// sidebar's row, one column away, did not (#2169).
	function friendMenu(friend: Friend): MenuEntry[] {
		const entries: MenuEntry[] = personMenu(friend.id, goto, {
			friendship: friend.status,
		});
		entries.push('separator');
		if (friend.room)
			entries.push({
				label: 'Walk in',
				icon: Radio,
				onSelect: () => goto(`/r/${friend.room}`),
			});
		entries.push({ ...exit(friend), icon: UserX, danger: true });
		return entries;
	}

	/** The way out of a standing, and what it is called there. */
	function exit(friend: Friend): { label: string; onSelect: () => void } {
		if (friend.status === 'pending_in')
			return {
				label: 'Dismiss the request',
				onSelect: () => void run(dismissRequest(friend)),
			};
		if (friend.status === 'pending_out')
			return {
				label: 'Withdraw the request',
				onSelect: () => void run(withdrawRequest(friend)),
			};
		return {
			label: 'Remove friend',
			onSelect: () => void run(removeFriend(friend)),
		};
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
				<!-- Padded to clear the 24 px floor without moving the row: a
				     label and a code beside the icon, so it is a text button,
				     not the kit's square one (#2170). -->
				<button
					onclick={() => void copyText(friends.code, 'Friend code copied.')}
					class="text-muted hover:text-ink -my-1 flex items-center gap-2 py-1 text-xs"
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
					maxlength={FriendCodeLen}
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
				<div class="panel panel-flush">
					{#each incoming as friend (friend.id)}
						{@render friendRow(friend, incomingActions)}
					{/each}
				</div>
				<div class="eyebrow mt-4 px-1 pb-1">your friends</div>
			{/if}
			<div class="panel panel-flush mt-3">
				{#each accepted as friend (friend.id)}
					{@render friendRow(friend, friendActions)}
				{/each}
				{#each outgoing as friend (friend.id)}
					{@render friendRow(friend, outgoingActions)}
				{/each}
			</div>
		{/if}
	{/if}
</section>

<!-- One row, whatever the standing (#2172): a face, the way to their page and
     the menu every person carries, then the answers this standing allows.
     A request used to be a bare name with two buttons and no menu, and an ask
     of yours plain text with no link at all — three shapes for one person,
     and the panel sent you to a page that could only say yes. -->
{#snippet friendRow(friend: Friend, actions: Snippet<[Friend]>)}
	<div
		class="border-muted/10 flex items-center gap-3 border-b px-4 py-3 last:border-b-0"
		title={MENU_HINT}
		{@attach contextMenu(() => friendMenu(friend))}
	>
		<!-- Slack's green dot (#251), now the avatar's own (#807): online =
		     app open (the lobby socket), with the room named only for shared
		     members. statusOf answers `null` for anyone it cannot vouch for,
		     so a request carries a face and no claim about where they are. -->
		<Avatar
			name={friend.name}
			avatarUrl={friend.avatarUrl}
			xp={friend.totalXp}
			status={statusOf(crewLive.crews, friend.id, friends.list)}
			ring="var(--color-surface-raised)"
			size={30}
		/>
		<span class="min-w-0 flex-1">
			<span class="flex min-w-0 items-center gap-1.5 text-sm font-medium">
				<!-- Their page (ADR-0024): shared rides, medals, the month —
				     and, for a request, who is asking before you answer. -->
				<!-- docs/SPEC.md allows 60 characters, and three controls hold
				     the other end of the row: the name gives way (#2182). -->
				<a href="/u/{friend.id}" class="truncate hover:underline"
					>{friend.name}</a
				>
				<!-- Lifetime level is friend-visible identity (#253); watts are
				     not (ADR-0012). -->
				<span class="text-muted-dim text-[10px] font-normal"
					>lv {levelFromXp(friend.totalXp ?? 0)}</span
				>
			</span>
		</span>
		<span class="text-muted min-w-0 shrink truncate text-xs">
			{#if friend.status === 'pending_out'}
				asked — waiting on them
			{:else}
				<!-- One sentence, one place (ADR-0012, #1743): the room's name
				     for a member, "riding elsewhere" for everyone else. -->
				{friendPlace(friend)}
			{/if}
		</span>
		<span class="ml-auto flex shrink-0 items-center gap-3">
			{@render actions(friend)}
		</span>
	</div>
{/snippet}

{#snippet incomingActions(friend: Friend)}
	<button
		onclick={() => void run(acceptRequest(friend))}
		class="btn btn-primary btn-xs">Accept</button
	>
	<button
		onclick={() => void run(dismissRequest(friend))}
		class="btn btn-ghost btn-xs">Dismiss</button
	>
{/snippet}

{#snippet outgoingActions(friend: Friend)}
	<button
		onclick={() => void run(withdrawRequest(friend))}
		class="btn btn-ghost btn-xs">Withdraw</button
	>
{/snippet}

{#snippet friendActions(friend: Friend)}
	<!-- The kit's icon button (#2170): the one control that starts a DM from
	     this page was a 15 px link, under ux.md's 24 px floor. -->
	<a
		href="/messages/dm/{friend.id}"
		onclick={() => dm.show(friend.id, friend.name)}
		class="icon-btn icon-btn-sm text-muted hover:text-ink relative"
		title="message {friend.name}"
		aria-label="message {friend.name}"
	>
		<MessageCircle size={15} />
		{#if dmHeads.unread(friend.id)}
			<span class="{UNREAD_DOT} absolute -top-0.5 -right-0.5"></span>
		{/if}
	</a>
	{#if friend.room}
		<!-- btn-accent is what walking into a room wears everywhere else. -->
		<a href="/r/{friend.room}" class="btn btn-accent btn-xs">Walk in</a>
	{/if}
	<button
		onclick={() => void run(removeFriend(friend))}
		class="btn btn-ghost btn-xs text-danger">Remove</button
	>
{/snippet}
