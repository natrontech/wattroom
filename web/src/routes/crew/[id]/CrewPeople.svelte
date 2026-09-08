<script lang="ts">
	import { formatMonth } from '$lib/format';
	// The crew's people and its bans (#1150, #1208, #1212): roles from a
	// person's menu, the hand-over behind a confirm, and the unban that names
	// what it does not reach. Split from the page (#1234); the page reloads on
	// `onchange`.
	import { goto } from '$app/navigation';
	import { account } from '$lib/account.svelte';
	import Avatar from '$lib/components/Avatar.svelte';
	import Modal from '$lib/components/Modal.svelte';
	import {
		contextMenu,
		MENU_HINT,
		type MenuEntry,
	} from '$lib/context-menu.svelte';
	import {
		setCrewRole,
		transferCrew,
		type Crew,
		type CrewPerson,
	} from '$lib/crew';
	import { personMenu } from '$lib/person-menu';
	import { presence } from '$lib/presence.svelte';
	import { toasts } from '$lib/toast.svelte';
	import Crown from '@lucide/svelte/icons/crown';
	import Shield from '@lucide/svelte/icons/shield';
	import ShieldBan from '@lucide/svelte/icons/shield-ban';
	import ShieldOff from '@lucide/svelte/icons/shield-off';

	let { crew, onchange }: { crew: Crew; onchange: () => void } = $props();
	const administers = $derived(crew.role === 'owner' || crew.role === 'admin');
	const owner = $derived(crew.role === 'owner');
	let busy = $state(false);

	async function act(
		person: CrewPerson,
		role: 'admin' | 'member' | 'banned',
		message: string,
	) {
		busy = true;
		const res = await setCrewRole(crew.id, person.id, role);
		busy = false;
		if (!res.ok) {
			toasts.push(res.error.message, { tone: 'error' });
			return;
		}
		toasts.push(message);
		onchange();
	}

	// Banning at the crew is reversible here (the unban below sets it right
	// back), so an undo toast rather than a confirm — the same shape the
	// room's Members place uses (#666, errors.md).
	function ban(person: CrewPerson) {
		const previous = person.role === 'admin' ? 'admin' : 'member';
		const crewId = crew.id;
		void setCrewRole(crewId, person.id, 'banned').then((res) => {
			if (!res.ok) {
				toasts.push(res.error.message, { tone: 'error' });
				return;
			}
			toasts.push(`Banned ${person.displayName} from the crew.`, {
				undo: () => void setCrewRole(crewId, person.id, previous),
			});
			onchange();
		});
	}

	const canAct = (person: CrewPerson) =>
		administers &&
		person.role !== 'owner' &&
		person.id !== account.me?.id &&
		!busy;

	// Handing the crew on (#1208) is the one thing here behind a confirm
	// rather than an undo toast: the actor cannot take it back — only the
	// new owner can hand it back to them.
	let handover = $state<CrewPerson | null>(null);
	async function handOver() {
		const to = handover;
		handover = null;
		if (!to) return;
		busy = true;
		const res = await transferCrew(crew.id, to.id);
		busy = false;
		if (!res.ok) {
			toasts.push(res.error.message, { tone: 'error' });
			return;
		}
		toasts.push(`${to.displayName} owns ${crew.name} now. You are an admin.`);
		presence.reload();
		onchange();
	}

	function personEntries(person: CrewPerson): MenuEntry[] {
		const entries: MenuEntry[] = personMenu(person.id, goto, {
			you: person.id === account.me?.id,
		});
		if (!canAct(person)) return entries;
		entries.push(
			'separator',
			person.role === 'admin'
				? {
						label: 'Make member',
						icon: ShieldOff,
						onSelect: () =>
							act(person, 'member', `${person.displayName} is a member now.`),
					}
				: {
						label: 'Make crew admin',
						icon: Shield,
						onSelect: () =>
							act(
								person,
								'admin',
								`${person.displayName} is a crew admin now.`,
							),
					},
		);
		if (owner)
			entries.push({
				label: `Hand the crew to ${person.displayName}`,
				icon: Crown,
				onSelect: () => (handover = person),
			});
		// A room owner cannot be banned from the crew their room is in (#1212):
		// the entry stays, says why, and does nothing — never a 409 on click.
		entries.push({
			label: 'Ban from the crew',
			icon: ShieldBan,
			onSelect: () => ban(person),
			danger: true,
			disabled: person.ownsRoom,
			hint: person.ownsRoom ? 'owns a room here' : undefined,
		});
		return entries;
	}

	const roleWord = (role: CrewPerson['role']) =>
		role === 'owner' ? 'owner' : role === 'admin' ? 'admin' : 'member';
</script>

{#if handover}
	<Modal label="Hand the crew on" onclose={() => (handover = null)}>
		<h2 class="font-display text-lg font-bold">
			Hand {crew.name} to {handover.displayName}?
		</h2>
		<p class="text-muted mt-2 text-sm">
			They become its owner — the one person nobody can demote, remove or ban —
			and you stay on as an admin. You cannot take this back; only they can hand
			it back to you.
		</p>
		<div class="mt-4 flex justify-end gap-2">
			<button onclick={() => (handover = null)} class="btn btn-secondary"
				>Cancel</button
			>
			<button onclick={handOver} disabled={busy} class="btn btn-primary"
				>Hand it over</button
			>
		</div>
	</Modal>
{/if}

<h2 class="eyebrow mt-8">people</h2>
<ul class="divide-ink/5 panel mt-2 divide-y">
	{#each crew.people as person (person.id)}
		<li
			class="flex min-h-11 items-center gap-3 px-4 py-2.5"
			title={MENU_HINT}
			{@attach contextMenu(() => personEntries(person))}
		>
			<a href="/u/{person.id}" class="shrink-0">
				<Avatar
					name={person.displayName}
					avatarUrl={person.avatarUrl}
					preset={person.avatarPreset}
					ring="var(--color-surface-raised)"
					size={32}
				/>
			</a>
			<span class="min-w-0 flex-1">
				<span class="flex items-center gap-1.5">
					<a
						href="/u/{person.id}"
						class="hover:text-ink truncate text-sm font-medium hover:underline"
						>{person.displayName}</a
					>
					{#if person.role === 'owner'}
						<Crown size={12} class="text-muted" aria-label="owner" />
					{:else if person.role === 'admin'}
						<Shield size={12} class="text-muted" aria-label="admin" />
					{/if}
				</span>
				<span class="text-muted block text-[11px]">
					{roleWord(person.role)}
					{#if person.rooms}
						· {person.rooms === 1 ? '1 room' : `${person.rooms} rooms`}
					{/if}
					· since {formatMonth(person.since)}
				</span>
			</span>
			{#if canAct(person)}
				<button
					onclick={() =>
						person.role === 'admin'
							? act(person, 'member', `${person.displayName} is a member now.`)
							: act(
									person,
									'admin',
									`${person.displayName} is a crew admin now.`,
								)}
					disabled={busy}
					class="btn btn-ghost btn-xs shrink-0"
					>{person.role === 'admin' ? 'Make member' : 'Make admin'}</button
				>
			{/if}
		</li>
	{/each}
</ul>

{#if administers && crew.banned?.length}
	<h2 class="eyebrow mt-8">banned from the crew</h2>
	<p class="text-muted mt-1 text-xs">
		Lifting a crew ban restores nothing a room's owner decided — a room that
		banned them stays shut (ADR-0038).
	</p>
	<ul class="divide-ink/5 panel mt-2 divide-y">
		{#each crew.banned as person (person.id)}
			<li class="flex min-h-11 items-center gap-3 px-4 py-2.5">
				<Avatar
					name={person.displayName}
					avatarUrl={person.avatarUrl}
					preset={person.avatarPreset}
					ring="var(--color-surface-raised)"
					size={32}
				/>
				<span class="min-w-0 flex-1">
					<span class="block truncate text-sm font-medium"
						>{person.displayName}</span
					>
					<span class="text-muted block text-[11px]"
						>banned from the crew · {formatMonth(person.since)}</span
					>
				</span>
				<!-- Two controls in two places, never one (#1150): this lifts
						     the CREW ban and names what it does not reach. -->
				<span class="flex shrink-0 flex-col items-end gap-0.5">
					<button
						onclick={() =>
							act(
								person,
								'member',
								`${person.displayName} is back in the crew.`,
							)}
						disabled={busy}
						class="btn btn-ghost btn-xs">Unban from {crew.name}</button
					>
					<span class="text-muted/70 text-[11px]"
						>restores nothing a room's owner decided</span
					>
				</span>
			</li>
		{/each}
	</ul>
{/if}
