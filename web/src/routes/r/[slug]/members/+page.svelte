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
	import { Award, Crown, Copy, UserMinus, UserX } from '@lucide/svelte';

	const room = useRoom();
	const isOwner = $derived(room.myRole === 'owner');

	const medalsOf = (name: string) =>
		room.medals.filter((m) => m.rider === name).length;

	type Member = (typeof room.members)[number];
	/** Owner paperwork, one place: the row's buttons and its menu run these. */
	const canAdmin = (member: Member) =>
		isOwner && member.id !== account.me?.id && !room.adminBusy;
	const toggleRole = (member: Member) =>
		room.setRole(member.id, member.role === 'coach' ? 'member' : 'coach');
	const roleLabel = (member: Member) =>
		member.role === 'coach' ? 'Make member' : 'Make coach';

	// Their page and their DM on every member (#486), plus the paperwork the
	// row already offers an owner — remove last, after a separator.
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
					onSelect: () => room.removeMember(member.id),
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
	<p class="text-muted mb-5 text-xs">
		The people column is the live read; this is the paperwork.
	</p>

	<ul class="divide-ink/5 panel divide-y">
		{#each room.members as member (member.id)}
			{@const medals = medalsOf(member.displayName)}
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
				{#if isOwner && member.id !== account.me?.id}
					<button
						onclick={() => toggleRole(member)}
						disabled={room.adminBusy}
						class="btn btn-ghost btn-xs shrink-0">{roleLabel(member)}</button
					>
					<button
						onclick={() => room.removeMember(member.id)}
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
