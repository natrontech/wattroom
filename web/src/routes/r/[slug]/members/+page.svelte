<script lang="ts">
	// The room's Members place (ADR-0020) — #181's third gap, the paperwork
	// half. The people column is the live read: who is here, who is talking,
	// who is holding target. This is roles, medals and the invite, which is
	// what /rooms used to carry.
	import { confirm } from '$lib/confirm.svelte';
	import Avatar from '$lib/components/Avatar.svelte';
	import { useRoom } from '$lib/room/context';
	import { account } from '$lib/account.svelte';
	import { toasts } from '$lib/toast.svelte';
	import { levelFromXp } from '$lib/level';
	import { statusOfRider } from '$lib/status';
	import { wkg, formatMonth } from '$lib/format';
	import {
		MENU_HINT,
		type MenuEntry,
		contextMenu,
		openMenu,
	} from '$lib/context-menu.svelte';
	import { copyInviteLink } from '$lib/crew-flows';
	import { personMenu } from '$lib/person-menu';
	import { goto } from '$app/navigation';
	import Award from '@lucide/svelte/icons/award';
	import Ellipsis from '@lucide/svelte/icons/ellipsis';
	import Crown from '@lucide/svelte/icons/crown';
	import Link from '@lucide/svelte/icons/link';
	import ShieldBan from '@lucide/svelte/icons/shield-ban';
	import UserMinus from '@lucide/svelte/icons/user-minus';
	import UserX from '@lucide/svelte/icons/user-x';
	import { ACHIEVEMENTS } from '$lib/trophies/catalogue';

	const room = useRoom();
	const isOwner = $derived(room.myRole === 'owner');

	// A room's own crew comparing itself is the ONE ladder WATTROOM.md
	// allows — "your crew's ladder, not the internet's" — and ADR-0027
	// keeps it here: no ordering by badges on Home, the friends list, or
	// any surface that is not one room. Deliberately not exported.
	type Order = 'joined' | 'level' | 'badges';
	let order = $state<Order>('joined');
	const ORDERS: { id: Order; label: string }[] = [
		{ id: 'joined', label: 'Joined' },
		{ id: 'level', label: 'Level' },
		{ id: 'badges', label: 'Badges' },
	];

	const badgeMeta = new Map(ACHIEVEMENTS.map((a) => [a.key, a]));
	/** Earned keys the client can draw — an unknown key is a newer server. */
	const badgesOf = (member: Member) =>
		(member.badges ?? []).flatMap((key) => badgeMeta.get(key) ?? []);

	const ordered = $derived(
		order === 'joined'
			? room.members
			: [...room.members].sort((a, b) =>
					order === 'level'
						? (b.totalXp ?? 0) - (a.totalXp ?? 0)
						: (b.badges?.length ?? 0) - (a.badges?.length ?? 0),
				),
	);

	type Member = (typeof room.members)[number];
	/** Owner paperwork, one place: the row's buttons and its menu run these. */
	const canAdmin = (member: Member) =>
		isOwner && member.id !== account.me?.id && !room.adminBusy;
	const toggleRole = (member: Member) =>
		room.setRole(member.id, member.role === 'coach' ? 'member' : 'coach');
	const roleLabel = (member: Member) =>
		member.role === 'coach' ? 'Make member' : 'Make coach';
	// Removing a member has no inverse call — rejoining takes the invite
	// link, not an undo this app can fire on its own — so it confirms
	// instead of promising an undo it can't deliver (errors.md).
	async function confirmRemove(member: Member) {
		const ok = await confirm({
			title: `Remove ${member.displayName} from ${room.roomName}?`,
			body: 'They stay in the crew and can walk back in if the room is open to it.',
			action: 'Remove',
			cancel: 'Keep it',
		});
		if (ok) room.removeMember(member.id);
	}

	// Banning is reversible (Unban sets the role right back), so it gets an
	// undo toast rather than a confirm dialog (errors.md) — the same pattern
	// settings/+page.svelte's ban list already uses (#666).
	function ban(member: Member) {
		const { id, displayName, role: previousRole } = member;
		// Said once the server took it (audit 2026-09-09), never beside its
		// own refusal.
		void Promise.resolve(room.setRole(id, 'banned')).then((ok) => {
			if (ok === false) return;
			toasts.push(`Banned ${displayName}.`, {
				undo: () => void room.setRole(id, previousRole),
			});
		});
	}
	const unban = (member: Member) => room.setRole(member.id, 'member');

	// Handing the room on (#1227) is the one thing here the actor cannot
	// take back — only the new owner can — so a confirm, not an undo toast.
	async function confirmTransfer(member: Member) {
		const ok = await confirm({
			title: `Hand ${room.roomName} to ${member.displayName}?`,
			body: 'They become its owner and you stay on as a coach. You cannot take this back; only they can hand it back to you.',
			action: 'Hand it over',
			cancel: 'Keep it',
		});
		if (ok) room.transfer(member.id);
	}

	// Their page and their DM on every member (#486), plus the paperwork the
	// row already offers an owner — remove above ban, ban last, both after a
	// separator (#666: ban belongs where the griefer is met, not three
	// screens away in Settings).
	function memberMenu(member: Member): MenuEntry[] {
		const rider = room.riders.find((r) => r.id === member.id);
		const here = !!rider;
		const entries: MenuEntry[] = personMenu(member.id, goto, {
			you: member.id === account.me?.id,
			volume: rider?.inVoice ? { name: member.displayName } : undefined,
			poke: {
				onSelect: () => room.poke(member.id),
				disabled: !here,
				hint: here ? undefined : 'not in the room',
			},
		});
		if (member.role === 'banned') {
			if (canAdmin(member))
				entries.push('separator', {
					label: `Unban from ${room.roomName}`,
					icon: ShieldBan,
					hint: member.crewBanned ? 'still crew-banned' : undefined,
					onSelect: () => unban(member),
				});
			return entries;
		}
		if (canAdmin(member)) {
			entries.push(
				{
					label: roleLabel(member),
					icon: member.role === 'coach' ? UserMinus : Crown,
					onSelect: () => toggleRole(member),
				},
				{
					label: `Hand the room to ${member.displayName}`,
					icon: Crown,
					onSelect: () => confirmTransfer(member),
				},
				'separator',
				{
					label: 'Remove from the room',
					icon: UserX,
					onSelect: () => confirmRemove(member),
					danger: true,
				},
				{
					label: 'Ban from the room',
					icon: ShieldBan,
					onSelect: () => ban(member),
					danger: true,
				},
			);
		}
		return entries;
	}
</script>

<div class="page">
	<h2 class="font-display mb-1 text-xl font-bold">
		Members — {room.members.length}
	</h2>
	<p class="text-muted mb-3 text-xs">
		The people column is the live read; this is the paperwork.
	</p>

	<!-- Ordering the crew is room-scoped on purpose (ADR-0027). -->
	<div class="mb-5 flex items-center gap-1.5">
		<span class="text-muted/70 mr-1 text-[11px]">by</span>
		{#each ORDERS as option (option.id)}
			<button
				onclick={() => (order = option.id)}
				class="min-h-9 rounded px-2.5 py-1 text-xs {order === option.id
					? 'bg-surface-raised text-ink'
					: 'text-muted hover:text-ink'}"
				aria-pressed={order === option.id}>{option.label}</button
			>
		{/each}
	</div>

	<ul class="divide-ink/5 panel divide-y">
		{#each ordered as member (member.id)}
			{@const medals = member.medals ?? 0}
			{@const badges = badgesOf(member)}
			{@const here = room.riders.find((r) => r.id === member.id)}
			<li
				class="flex items-center gap-3 px-4 py-2.5"
				title={MENU_HINT}
				{@attach contextMenu(() => memberMenu(member))}
			>
				<!-- A member is clickable (#448): their page, and add-friend on it. -->
				<a href="/u/{member.id}" class="shrink-0">
					<Avatar
						name={member.displayName}
						avatarUrl={member.avatarUrl}
						xp={member.totalXp}
						status={here ? statusOfRider(here) : 'offline'}
						ring="var(--color-surface-raised)"
						size={32}
					/>
				</a>
				<span class="min-w-0 flex-1">
					<span class="flex items-center gap-1.5">
						<a
							href="/u/{member.id}"
							class="hover:text-ink truncate text-sm font-medium hover:underline"
							>{member.displayName}</a
						>
						{#if member.role === 'owner'}
							<Crown size={12} class="text-muted" />
						{/if}
						<span class="text-muted/70 text-[10px]"
							>lv {levelFromXp(member.totalXp ?? 0)}</span
						>
					</span>
					<!-- Room-visible rider facts (#207): the same numbers the roster
					     tiles show. Rides and history stay private. -->
					<span class="text-muted block text-[11px] tabular-nums">
						{member.role}
						{#if member.ftpWatts}
							· {member.ftpWatts} W
							{#if member.weightKg}
								· {wkg(member.ftpWatts, member.weightKg)} w/kg{/if}
						{/if}
						{#if member.joinedAt}
							· since {formatMonth(member.joinedAt)}
						{/if}
					</span>
				</span>
				<!-- What they have done, beside what they won here (#703): the
				     badges are lifetime and earned-only, the medals are this
				     room's. No progress and no "n of 10" — ADR-0027. -->
				{#if badges.length > 0}
					<span
						class="text-muted flex shrink-0 items-center gap-1"
						title={badges.map((b) => b.name).join(', ')}
					>
						{#each badges.slice(0, 4) as badge (badge.key)}
							<badge.icon size={13} class="text-neon" />
						{/each}
						{#if badges.length > 4}
							<span class="text-[11px] tabular-nums">+{badges.length - 4}</span>
						{/if}
						<span class="sr-only"
							>{badges.length === 1
								? '1 badge'
								: `${badges.length} badges`}</span
						>
					</span>
				{/if}
				{#if medals > 0}
					<span
						class="text-muted flex shrink-0 items-center gap-1 text-xs tabular-nums"
					>
						<Award size={13} class="text-neon" />
						{medals}
						<span class="sr-only">{medals === 1 ? 'medal' : 'medals'}</span>
					</span>
				{/if}
				{#if member.role === 'banned' && canAdmin(member)}
					<!-- The room's unban lifts the room's ban and nothing else
					     (ADR-0038, third amendment; #1150). When the crew also
					     banned them, the row says so before the click, not after. -->
					<span class="flex shrink-0 flex-col items-end gap-0.5">
						<button
							onclick={() => unban(member)}
							disabled={room.adminBusy}
							class="btn btn-ghost btn-xs">Unban from {room.roomName}</button
						>
						{#if member.crewBanned}
							<span class="text-muted/70 text-[11px]"
								>still crew-banned afterwards — this does not readmit them</span
							>
						{/if}
					</span>
				{:else if isOwner && member.id !== account.me?.id}
					<button
						onclick={() => toggleRole(member)}
						disabled={room.adminBusy}
						class="btn btn-ghost btn-xs shrink-0">{roleLabel(member)}</button
					>
					<button
						onclick={() => confirmRemove(member)}
						disabled={room.adminBusy}
						class="btn btn-ghost btn-xs text-danger shrink-0">Remove</button
					>
					<!-- The rest of the owner's paperwork — hand over, ban — has a
					     visible way in: nothing lives only in a menu (ux.md, #1372).
					     The same menu the right-click opens, so the two cannot
					     disagree. -->
					<button
						onclick={(e) => {
							const at = e.currentTarget.getBoundingClientRect();
							openMenu(
								memberMenu(member),
								at.left,
								at.bottom + 4,
								e.currentTarget,
							);
						}}
						disabled={room.adminBusy}
						class="btn btn-ghost btn-xs shrink-0"
						aria-label="more actions for {member.displayName}"
						title="hand the room over · ban"><Ellipsis size={14} /></button
					>
				{/if}
			</li>
		{/each}
	</ul>

	{#if isOwner && !room.crewVisible && (room.invited.length || room.crewOutside.length)}
		<!-- A private room's named exceptions (ADR-0038, #1224). A grant is a
		     door, not a membership: they see the room in their sidebar and walk
		     in themselves — being let in is not joining, so nothing of theirs
		     is shown here until they do. -->
		<h3 class="eyebrow mt-8">let in from the crew</h3>
		<p class="text-muted mt-1 text-xs">
			This room is private. A crew-mate you let in sees it in their sidebar and
			can walk in — they still join themselves. Open the room to the whole crew
			in Settings instead if that is what you mean.
		</p>
		<ul class="divide-ink/5 panel mt-2 divide-y">
			{#each room.invited as person (person.id)}
				<li class="flex min-h-11 items-center gap-3 px-4 py-2">
					<Avatar
						name={person.displayName}
						avatarUrl={person.avatarUrl}
						ring="var(--color-surface-raised)"
						size={28}
					/>
					<span class="min-w-0 flex-1">
						<span class="block truncate text-sm">{person.displayName}</span>
						<span class="text-muted block text-[11px]">let in · not in yet</span
						>
					</span>
					<button
						onclick={() => room.revoke(person.id)}
						disabled={room.adminBusy}
						class="btn btn-ghost btn-xs shrink-0">Take back</button
					>
				</li>
			{/each}
			{#each room.crewOutside as person (person.id)}
				<li class="flex min-h-11 items-center gap-3 px-4 py-2">
					<Avatar
						name={person.displayName}
						avatarUrl={person.avatarUrl}
						ring="var(--color-surface-raised)"
						size={28}
					/>
					<span class="min-w-0 flex-1">
						<span class="block truncate text-sm">{person.displayName}</span>
						<span class="text-muted block text-[11px]"
							>in the crew, not in this room</span
						>
					</span>
					<button
						onclick={() => room.grant(person.id)}
						disabled={room.adminBusy}
						class="btn btn-secondary btn-xs shrink-0">Let in</button
					>
				</li>
			{/each}
		</ul>
	{/if}

	{#if room.code}
		<!-- "How do I get someone in here?" is asked from the room, so the
		     answer stands here too (#1236): there is one invite, the crew's,
		     and this is where the room used to show its own code. -->
		<h3 class="eyebrow mt-8">invite</h3>
		<div class="panel mt-2 flex flex-wrap items-center gap-3 px-4 py-3">
			<p class="text-muted min-w-0 flex-1 text-xs">
				{#if room.crewVisible}
					Everyone in the crew can walk in. To bring someone new, invite them to
					the crew — rooms have no codes of their own.
				{:else}
					This room is private: crew-mates come in when you let them in above.
					Someone new joins the crew first.
				{/if}
			</p>
			<button
				onclick={() => void copyInviteLink(room.code)}
				class="btn btn-secondary btn-xs shrink-0"
				><Link size={13} /> Copy invite link</button
			>
		</div>
	{/if}

	{#if room.medals.length > 0}
		<h3 class="eyebrow mt-8">medal history</h3>
		<ul class="divide-ink/5 panel mt-2 divide-y">
			<!-- Unkeyed on purpose: a read-only snapshot of at most twelve rows
			     with no per-row state. `awardedAt` is a date, and one session
			     hands out four medals, so day+rider collided the moment anyone
			     took two in a day — and Svelte's each_key_duplicate left the
			     whole place unrenderable (#567). kind+rider+day is no safer:
			     two sessions in one day can award the same medal twice. -->
			{#each room.medals.slice(0, 12) as medal}
				<li class="flex items-center gap-3 px-4 py-2 text-xs">
					<Award size={13} class="text-neon shrink-0" aria-label="Medal" />
					<span class="min-w-0 flex-1 truncate">{medal.rider}</span>
					<span class="text-muted truncate">{medal.kind}</span>
					<span class="text-muted/60 shrink-0 tabular-nums"
						>{new Date(medal.awardedAt).toLocaleDateString()}</span
					>
				</li>
			{/each}
		</ul>
	{/if}
</div>
