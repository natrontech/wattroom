<script lang="ts">
	// The room's paperwork — invite, members, medals, settings — lives in a
	// drawer so the room itself can be the full-viewport app the design is.
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

		{#if streakWeeks > 0 || monthKj > 0}
			<div class="mt-4">
				<span class="text-muted text-[10px] tracking-[0.2em] uppercase"
					>crew streak</span
				>
				<p class="font-display text-sm font-bold">
					{streakWeeks} wk · {(monthKj / 1000).toFixed(1)} MJ this month
				</p>
			</div>
		{/if}

		<div class="mt-4">
			<span class="text-muted text-[10px] tracking-[0.2em] uppercase"
				>invite link</span
			>
			<p class="font-mono text-sm break-all select-all">
				{location.origin}/r/{slug}
			</p>
		</div>
		{#if code}
			<div class="mt-3">
				<span class="text-muted text-[10px] tracking-[0.2em] uppercase"
					>code</span
				>
				<p class="font-mono text-xl tracking-[0.3em] select-all">{code}</p>
			</div>
		{/if}

		<a
			href="/r/{slug}/watch"
			class="text-muted hover:text-ink mt-3 text-xs underline"
			>Watch on a phone (read-only)</a
		>

		{#if medals.length > 0}
			<div class="mt-6">
				<span class="text-muted text-[10px] tracking-[0.2em] uppercase"
					>medals</span
				>
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

		<div class="mt-6">
			<span class="text-muted text-[10px] tracking-[0.2em] uppercase"
				>members</span
			>
			<ul class="mt-2 grid gap-2">
				{#each members as member (member.id)}
					<li
						class="border-muted/15 bg-surface-raised flex items-center gap-2 rounded-lg border px-4 py-2.5"
					>
						<span class="text-sm font-medium">{member.displayName}</span>
						<span class="text-muted text-[10px] tracking-wider uppercase"
							>{member.role}</span
						>
						{#if isOwner && member.role === 'banned'}
							<!-- Only the owner ever receives banned rows (#223). -->
							<button
								onclick={() => onRole(member.id, 'member')}
								disabled={busy}
								class="border-muted/30 hover:border-muted/60 ml-auto rounded border px-2.5 py-1 text-[11px] disabled:opacity-40"
								>Unban</button
							>
						{:else if isOwner && member.role !== 'owner'}
							<div class="ml-auto flex gap-1.5">
								<button
									onclick={() =>
										onRole(
											member.id,
											member.role === 'coach' ? 'member' : 'coach',
										)}
									disabled={busy}
									class="border-muted/30 hover:border-muted/60 rounded border px-2.5 py-1 text-[11px] disabled:opacity-40"
									>{member.role === 'coach' ? 'Demote' : 'Make coach'}</button
								>
								<button
									onclick={() => onRemove(member.id)}
									disabled={busy}
									class="border-z6/40 text-z6 hover:bg-z6/10 rounded border px-2.5 py-1 text-[11px] disabled:opacity-40"
									>Remove</button
								>
								<button
									onclick={() => onRole(member.id, 'banned')}
									disabled={busy}
									class="border-z6/40 text-z6 hover:bg-z6/10 rounded border px-2.5 py-1 text-[11px] disabled:opacity-40"
									>Ban</button
								>
							</div>
						{/if}
					</li>
				{/each}
			</ul>
		</div>

		<div class="mt-6">
			{#if isOwner}
				<a
					href="/r/{slug}/settings"
					class="text-muted hover:text-ink inline-block text-xs underline"
					>Room settings</a
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
