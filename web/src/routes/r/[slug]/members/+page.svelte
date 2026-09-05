<script lang="ts">
	// The room's Members place (ADR-0020) — #181's third gap, the paperwork
	// half. The people column is the live read: who is here, who is talking,
	// who is holding target. This is roles, medals and the invite, which is
	// what /rooms used to carry.
	import Avatar from '$lib/components/Avatar.svelte';
	import RiderVolume from '$lib/room/RiderVolume.svelte';
	import { useRoom } from '$lib/room/context';
	import { account } from '$lib/account.svelte';
	import { toasts } from '$lib/toast.svelte';
	import { levelFromXp } from '$lib/level';
	import { wkg } from '$lib/format';
	import {
		contextMenu,
		MENU_HINT,
		type MenuEntry,
	} from '$lib/context-menu.svelte';
	import { personMenu } from '$lib/person-menu';
	import { goto } from '$app/navigation';
	import {
		Award,
		Crown,
		Copy,
		ShieldBan,
		UserMinus,
		UserX,
	} from '@lucide/svelte';
	import { ACHIEVEMENTS } from '$lib/trophies/catalogue';

	const room = useRoom();
	const isOwner = $derived(room.myRole === 'owner');

	const medalsOf = (name: string) =>
		room.medals.filter((m) => m.rider === name).length;

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
	function confirmRemove(member: Member) {
		if (
			confirm(
				`Remove ${member.displayName} from ${room.roomName}? They can rejoin with the room's invite link.`,
			)
		)
			room.removeMember(member.id);
	}

	// Banning is reversible (Unban sets the role right back), so it gets an
	// undo toast rather than a confirm dialog (errors.md) — the same pattern
	// settings/+page.svelte's ban list already uses (#666).
	function ban(member: Member) {
		const { id, displayName, role: previousRole } = member;
		room.setRole(id, 'banned');
		toasts.push(`Banned ${displayName}.`, {
			undo: () => room.setRole(id, previousRole),
		});
	}
	const unban = (member: Member) => room.setRole(member.id, 'member');

	// Their page and their DM on every member (#486), plus the paperwork the
	// row already offers an owner — remove above ban, ban last, both after a
	// separator (#666: ban belongs where the griefer is met, not three
	// screens away in Settings).
	function memberMenu(member: Member): MenuEntry[] {
		const here = room.riders.some((rider) => rider.id === member.id);
		const entries: MenuEntry[] = personMenu(member.id, goto, {
			you: member.id === account.me?.id,
			poke: {
				onSelect: () => room.poke(member.id),
				disabled: !here,
				hint: here ? undefined : 'not in the room',
			},
		});
		if (member.role === 'banned') {
			if (canAdmin(member))
				entries.push('separator', {
					label: 'Unban',
					icon: ShieldBan,
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

	async function copyInvite() {
		await navigator.clipboard.writeText(`${location.origin}/r/${room.slug}`);
		toasts.push('Invite link copied.');
	}
</script>

<div class="page">
	<h2 class="font-display mb-1 text-xl font-bold">
		Who rides here — {room.members.length}
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
			{@const medals = medalsOf(member.displayName)}
			{@const badges = badgesOf(member)}
			{@const here = room.riders.find((r) => r.id === member.id)}
			<!-- Wrapping, so a member's volume slider (#463) takes its own line. -->
			<li
				class="flex flex-wrap items-center gap-3 px-4 py-2.5"
				title={MENU_HINT}
				{@attach contextMenu(() => memberMenu(member))}
			>
				<!-- A member is clickable (#448): their page, and add-friend on it. -->
				<a href="/u/{member.id}" class="shrink-0">
					<Avatar
						name={member.displayName}
						avatarUrl={member.avatarUrl}
						preset={member.avatarPreset}
						xp={member.totalXp}
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
							· since {new Date(member.joinedAt).toLocaleDateString(undefined, {
								month: 'short',
								year: 'numeric',
							})}
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
				{#if here?.inVoice && !here.you}
					<!-- Their volume, the same control as their row in the people
					     column — here for the member you came to look up. -->
					<RiderVolume id={member.id} name={member.displayName} />
				{/if}
				{#if member.role === 'banned' && canAdmin(member)}
					<button
						onclick={() => unban(member)}
						disabled={room.adminBusy}
						class="btn btn-ghost btn-xs shrink-0">Unban</button
					>
				{:else if isOwner && member.id !== account.me?.id}
					<button
						onclick={() => toggleRole(member)}
						disabled={room.adminBusy}
						class="btn btn-ghost btn-xs shrink-0">{roleLabel(member)}</button
					>
					<button
						onclick={() => confirmRemove(member)}
						disabled={room.adminBusy}
						class="text-muted hover:text-danger shrink-0 text-[11px]"
						>remove</button
					>
				{/if}
			</li>
		{/each}
	</ul>

	<h3 class="eyebrow mt-8">invite</h3>
	<div class="panel mt-2 flex flex-wrap items-center gap-3 px-4 py-3">
		<span class="min-w-0">
			<span class="eyebrow">room code</span>
			<span class="font-display block text-lg font-bold tracking-widest"
				>{room.code}</span
			>
		</span>
		<button onclick={copyInvite} class="btn btn-secondary btn-xs ml-auto"
			><Copy size={13} /> Copy invite link</button
		>
	</div>

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
