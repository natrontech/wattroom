<script lang="ts">
	import { formatMonth } from '$lib/format';
	// The crew's people and its bans (#1150, #1208, #1212): roles from a
	// person's menu, the hand-over behind a confirm, and the unban that names
	// what it does not reach. Split from the page (#1234), and the crew's
	// Members page since #2453, with each person's medals; the page reloads on
	// `onchange`.
	import { goto } from '$app/navigation';
	import { account } from '$lib/account.svelte';
	import Avatar from '$lib/components/Avatar.svelte';
	import {
		contextMenu,
		MENU_HINT,
		openMenu,
		type MenuEntry,
	} from '$lib/context-menu.svelte';
	import { setCrewRole, type Crew, type CrewPerson } from '$lib/crew';
	import { banFromCrewFlow, handOverCrewFlow } from '$lib/crew-flows';
	import { personMenu } from '$lib/person-menu';
	import { toasts } from '$lib/toast.svelte';
	import Award from '@lucide/svelte/icons/award';
	import Crown from '@lucide/svelte/icons/crown';
	import Ellipsis from '@lucide/svelte/icons/ellipsis';
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

	// One label and one call per role change, for the row and its menu alike.
	const roleLabel = (person: CrewPerson) =>
		person.role === 'admin' ? 'Make member' : 'Make admin';
	const toggleRole = (person: CrewPerson) =>
		person.role === 'admin'
			? act(person, 'member', `${person.displayName} is a member now.`)
			: act(person, 'admin', `${person.displayName} is a crew admin now.`);

	// A confirm, not an undo (#1674): banFromCrewFlow says why.
	async function ban(person: CrewPerson) {
		if (await banFromCrewFlow(crew, person)) onchange();
	}

	const canAct = (person: CrewPerson) =>
		administers &&
		person.role !== 'owner' &&
		person.id !== account.me?.id &&
		!busy;

	// Handing the crew on (#1208) is the one thing here behind a confirm
	// rather than an undo toast: the actor cannot take it back — only the
	// new owner can hand it back to them. The ask and the call live in
	// `crew-flows.ts` beside leaving, so they cannot drift apart (#2095).
	async function handOver(person: CrewPerson) {
		busy = true;
		const done = await handOverCrewFlow(crew, person);
		busy = false;
		if (done) onchange();
	}

	/** The banned row's menu (#1934): the person, and the one lift. */
	function bannedEntries(person: CrewPerson): MenuEntry[] {
		return [
			...personMenu(person.id, goto, { you: false }),
			'separator',
			{
				label: 'Unban from the crew',
				icon: Shield,
				onSelect: () =>
					act(person, 'member', `${person.displayName} is back in the crew.`),
			},
		];
	}

	function personEntries(person: CrewPerson): MenuEntry[] {
		const entries: MenuEntry[] = personMenu(person.id, goto, {
			you: person.id === account.me?.id,
		});
		if (!canAct(person)) return entries;
		entries.push('separator', {
			label: roleLabel(person),
			icon: person.role === 'admin' ? ShieldOff : Shield,
			onSelect: () => toggleRole(person),
		});
		if (owner)
			entries.push({
				label: `Hand the crew to ${person.displayName}`,
				icon: Crown,
				onSelect: () => handOver(person),
			});
		entries.push({
			label: 'Ban from the crew',
			icon: ShieldBan,
			onSelect: () => ban(person),
			danger: true,
		});
		return entries;
	}

	const roleWord = (role: CrewPerson['role']) =>
		role === 'owner' ? 'owner' : role === 'admin' ? 'admin' : 'member';

	// The crew is bigger than this list when the viewer shares no channel with
	// some of it (ADR-0058: visibility follows the channels two riders may
	// both enter). The header counts the crew, so without this line the page
	// contradicts itself — "3 people" over a list of two, with nothing saying
	// why (#1255). A number, never the names: who is in the private channel
	// is exactly what the rule withholds.
	const unseen = $derived(
		Math.max(0, (crew.members ?? 0) - crew.people.length),
	);
</script>

<h2 class="eyebrow mt-8">people</h2>
<ul class="divide-ink/5 panel panel-flush mt-2 divide-y">
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
					· since {formatMonth(person.since)}
				</span>
			</span>
			{#if person.medals}
				<!-- The crew's sessions awarded them, lifetime (#1371, #2442). -->
				<span
					class="text-muted flex shrink-0 items-center gap-1 text-xs tabular-nums"
				>
					<Award size={13} class="text-neon" />
					{person.medals}
					<span class="sr-only">{person.medals === 1 ? 'medal' : 'medals'}</span
					>
				</span>
			{/if}
			{#if canAct(person)}
				<button
					onclick={() => toggleRole(person)}
					disabled={busy}
					class="btn btn-ghost btn-xs shrink-0">{roleLabel(person)}</button
				>
				<!-- The rest of the owner's paperwork — hand over, ban — has a
				     visible way in, the way the Members place has had one since
				     #1372: nothing lives only in a menu (ux.md). It was
				     right-click on a desk and a long-press on touch, with a
				     tooltip no phone shows — while this same page tells the
				     owner to "hand it to someone in the people list first"
				     (#2154). The same menu the right-click opens, so the two
				     cannot disagree. -->
				<button
					onclick={(e) => {
						const at = e.currentTarget.getBoundingClientRect();
						openMenu(
							personEntries(person),
							at.left,
							at.bottom + 4,
							e.currentTarget,
						);
					}}
					disabled={busy}
					class="btn btn-ghost btn-xs shrink-0"
					aria-label="more actions for {person.displayName}"
					title={owner ? 'hand the crew over · ban' : 'ban from the crew'}
					><Ellipsis size={14} /></button
				>
			{/if}
		</li>
	{/each}
</ul>
{#if unseen > 0}
	<p class="text-muted mt-2 text-xs">
		And {unseen === 1 ? '1 more person' : `${unseen} more people`} you do not share
		a channel with. A crew's list is the crew-mates you have a channel in common with.
	</p>
{/if}

{#if administers && crew.banned?.length}
	<h2 class="eyebrow mt-8">banned from the crew</h2>
	<p class="text-muted mt-1 text-xs">
		Lifting a ban lets them back into the open channels — the private ones they
		were named into stay shut (ADR-0058).
	</p>
	<ul class="divide-ink/5 panel panel-flush mt-2 divide-y">
		{#each crew.banned as person (person.id)}
			<!-- The same links and menu as a person's row (#1934): an admin
			     checks whom they banned before lifting it. -->
			<li
				class="flex min-h-11 items-center gap-3 px-4 py-2.5"
				title={MENU_HINT}
				{@attach contextMenu(() => bannedEntries(person))}
			>
				<a href="/u/{person.id}" class="shrink-0">
					<Avatar
						name={person.displayName}
						avatarUrl={person.avatarUrl}
						ring="var(--color-surface-raised)"
						size={32}
					/>
				</a>
				<span class="min-w-0 flex-1">
					<a
						href="/u/{person.id}"
						class="hover:text-ink block truncate text-sm font-medium hover:underline"
						>{person.displayName}</a
					>
					<span class="text-muted block text-[11px]"
						>banned from the crew · {formatMonth(person.since)}</span
					>
				</span>
				<!-- This lifts the ban and names what it does not reach
				     (#1150). -->
				<!-- min-w-0, not shrink-0: a sixty-character crew name in the
				     button pushed the page sideways at 375px (audit 2026-09-09);
				     the row above already names the crew. -->
				<span class="flex min-w-0 flex-col items-end gap-0.5 text-right">
					<button
						onclick={() =>
							act(
								person,
								'member',
								`${person.displayName} is back in the crew.`,
							)}
						disabled={busy}
						class="btn btn-ghost btn-xs">Unban from the crew</button
					>
					<span class="text-muted-dim text-[11px]"
						>private channels stay shut</span
					>
				</span>
			</li>
		{/each}
	</ul>
{/if}
