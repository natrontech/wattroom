<script lang="ts">
	import { MessageCircle, UserPlus, X } from '@lucide/svelte';
	import Modal from '$lib/components/Modal.svelte';
	import { dm } from '$lib/dm/dm.svelte';
	import { api } from '$lib/api';
	import { wkg } from '$lib/format';
	import { account } from '$lib/account.svelte';

	// The member popout (#207): who this rider is, in room-visible terms.
	// Rides and history stay private — this shows what the room already sees.
	interface Member {
		id: string;
		displayName: string;
		role: string;
		ftpWatts: number;
		weightKg: number;
		joinedAt: string;
	}
	interface Medal {
		kind: string;
		rider: string;
		awardedAt: string;
	}
	let {
		member,
		roomName,
		medals = [],
		online = false,
		inVoice = false,
		onClose,
	}: {
		member: Member;
		roomName: string;
		medals?: Medal[];
		online?: boolean;
		inVoice?: boolean;
		onClose: () => void;
	} = $props();

	const MEDAL_NAME: Record<string, string> = {
		watts: 'Biggest engine',
		wkg: 'Pound for pound',
		sprint: 'Sprint king',
		execution: 'Metronome',
		lantern: 'Lanterne rouge',
	};

	const mine = $derived(
		medals.filter((medal) => medal.rider === member.displayName),
	);
	const medalCounts = $derived.by(() => {
		const counts = new Map<string, number>();
		for (const medal of mine)
			counts.set(medal.kind, (counts.get(medal.kind) ?? 0) + 1);
		return [...counts.entries()];
	});

	// Friendship state decides the one action this card offers (ADR-0012).
	let friendState = $state<
		'unknown' | 'candidate' | 'pending' | 'friends' | 'self'
	>('unknown');
	$effect(() => {
		if (member.id === account.me?.id) {
			friendState = 'self';
			return;
		}
		void api<{
			friends: { id: string; status: string }[];
			candidates: { id: string }[];
		}>('/api/friends').then((res) => {
			if (!res.ok) return;
			const existing = res.data.friends.find((f) => f.id === member.id);
			if (existing)
				friendState = existing.status === 'accepted' ? 'friends' : 'pending';
			else if (res.data.candidates.some((c) => c.id === member.id))
				friendState = 'candidate';
		});
	});
	async function addFriend() {
		const res = await api(`/api/friends/${member.id}`, { method: 'POST' });
		if (res.ok) friendState = 'pending';
	}
</script>

<Modal
	label="{member.displayName} in {roomName}"
	onclose={onClose}
	class="max-w-sm"
>
	<div class="flex items-start gap-3">
		<div class="min-w-0 flex-1">
			<p class="font-display truncate text-xl font-bold">
				{member.displayName}
			</p>
			<p class="text-muted mt-0.5 text-xs">
				{member.role} · in {roomName} since {member.joinedAt}
			</p>
			<p class="mt-1 flex items-center gap-1.5 text-xs">
				<span
					class="h-1.5 w-1.5 rounded-full {online ? 'bg-z4' : 'bg-muted/40'}"
				></span>
				{online ? (inVoice ? 'here, in voice' : 'here now') : 'not here'}
			</p>
		</div>
		<button
			onclick={onClose}
			class="text-muted hover:text-ink"
			aria-label="close"><X size={16} /></button
		>
	</div>

	<div class="mt-4 grid grid-cols-2 gap-3">
		<div class="border-muted/15 rounded border px-3 py-2">
			<p class="font-display text-lg font-bold tabular-nums">
				{member.ftpWatts}<span class="text-muted ml-1 text-xs">W</span>
			</p>
			<p class="eyebrow">ftp</p>
		</div>
		<div class="border-muted/15 rounded border px-3 py-2">
			<p class="font-display text-lg font-bold tabular-nums">
				{wkg(member.ftpWatts, member.weightKg)}<span
					class="text-muted ml-1 text-xs">w/kg</span
				>
			</p>
			<p class="eyebrow">at threshold</p>
		</div>
	</div>

	{#if medalCounts.length > 0}
		<div class="mt-4">
			<p class="eyebrow">medals in this room</p>
			<ul class="mt-1.5 space-y-1">
				{#each medalCounts as [kind, count] (kind)}
					<li class="flex items-baseline gap-2 text-xs">
						<span>{MEDAL_NAME[kind] ?? kind}</span>
						<span class="text-muted font-mono text-[10px] tabular-nums"
							>×{count}</span
						>
					</li>
				{/each}
			</ul>
		</div>
	{/if}

	{#if friendState === 'candidate'}
		<button onclick={() => void addFriend()} class="btn btn-primary mt-4 w-full"
			><UserPlus size={15} /> Add friend</button
		>
	{:else if friendState === 'pending'}
		<p class="text-muted mt-4 text-center text-xs">friend request pending</p>
	{:else if friendState === 'friends'}
		<button
			onclick={() => {
				dm.show(member.id, member.displayName);
				onClose();
			}}
			class="btn btn-primary mt-4 w-full"
			><MessageCircle size={15} /> Message</button
		>
	{/if}
</Modal>
