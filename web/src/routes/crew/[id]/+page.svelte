<script lang="ts">
	// The crew's own page (ADR-0038; #1150, #1151): its name, its rooms with
	// what you may do in each, its people with their crew roles, and — for
	// the owner and admins — the people it banned, with the one control that
	// lifts a crew ban and says what it does not reach. Nothing live: the
	// crew carries no voice, deck, session or metrics.
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { account } from '$lib/account.svelte';
	import Avatar from '$lib/components/Avatar.svelte';
	import Banner from '$lib/components/Banner.svelte';
	import RoomIcon from '$lib/components/RoomIcon.svelte';
	import Skeleton from '$lib/components/Skeleton.svelte';
	import {
		contextMenu,
		MENU_HINT,
		type MenuEntry,
	} from '$lib/context-menu.svelte';
	import {
		fetchCrew,
		renameCrew,
		setCrewRole,
		type Crew,
		type CrewPerson,
	} from '$lib/crew';
	import CrewIntro from '$lib/nav/CrewIntro.svelte';
	import { accessMark, reachable } from '$lib/nav/crews';
	import { personMenu } from '$lib/person-menu';
	import { presence } from '$lib/presence.svelte';
	import { toasts } from '$lib/toast.svelte';
	import Crown from '@lucide/svelte/icons/crown';
	import Pencil from '@lucide/svelte/icons/pencil';
	import Shield from '@lucide/svelte/icons/shield';
	import ShieldBan from '@lucide/svelte/icons/shield-ban';
	import ShieldOff from '@lucide/svelte/icons/shield-off';
	import { untrack } from 'svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const id = $derived(page.params.id ?? '');
	let crew = $state<Crew | null>(untrack(() => data.crew));
	let error = $state<string | null>(untrack(() => data.error));
	let loadedId = $state<string | null>(untrack(() => data.id));
	let busy = $state(false);

	async function load(which: string) {
		const res = await fetchCrew(which);
		if (!res.ok) {
			error = res.error.message;
			return;
		}
		error = null;
		crew = res.data;
	}

	$effect(() => {
		const which = id;
		if (!which || loadedId === which) return;
		if (data.id === which) {
			crew = data.crew;
			error = data.error;
			loadedId = which;
			return;
		}
		loadedId = which;
		crew = null;
		error = null;
		void load(which);
	});
	$effect(() => {
		// A role change or a rename pings the lobby (#570); re-read on it.
		presence.version;
		const loaded = untrack(() => crew);
		if (id && loaded) void load(id);
	});

	const administers = $derived(
		crew?.role === 'owner' || crew?.role === 'admin',
	);
	const owner = $derived(crew?.role === 'owner');

	// The name, editable in place for the owner and admins — the same field
	// the day-one card has, so a rename never needs a settings page (#1151).
	let editing = $state(false);
	let draft = $state('');
	let field = $state<HTMLInputElement | null>(null);
	function edit() {
		if (!crew) return;
		draft = crew.name;
		editing = true;
		queueMicrotask(() => field?.select());
	}
	async function saveName() {
		editing = false;
		const next = draft.trim();
		if (!crew || !next || next === crew.name) return;
		busy = true;
		const res = await renameCrew(crew.id, next);
		busy = false;
		if (!res.ok) {
			toasts.push(res.error.message, { tone: 'error' });
			return;
		}
		crew = { ...crew, name: res.data.name };
		presence.reload();
	}

	async function act(
		person: CrewPerson,
		role: 'admin' | 'member' | 'banned',
		message: string,
	) {
		if (!crew) return;
		busy = true;
		const res = await setCrewRole(crew.id, person.id, role);
		busy = false;
		if (!res.ok) {
			toasts.push(res.error.message, { tone: 'error' });
			return;
		}
		toasts.push(message);
		await load(crew.id);
	}

	// Banning at the crew is reversible here (the unban below sets it right
	// back), so an undo toast rather than a confirm — the same shape the
	// room's Members place uses (#666, errors.md).
	function ban(person: CrewPerson) {
		const previous = person.role === 'admin' ? 'admin' : 'member';
		if (!crew) return;
		const crewId = crew.id;
		void setCrewRole(crewId, person.id, 'banned').then((res) => {
			if (!res.ok) {
				toasts.push(res.error.message, { tone: 'error' });
				return;
			}
			toasts.push(`Banned ${person.displayName} from the crew.`, {
				undo: () => void setCrewRole(crewId, person.id, previous),
			});
			void load(crewId);
		});
	}

	const canAct = (person: CrewPerson) =>
		administers &&
		person.role !== 'owner' &&
		person.id !== account.me?.id &&
		!busy;

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
			{
				label: 'Ban from the crew',
				icon: ShieldBan,
				onSelect: () => ban(person),
				danger: true,
			},
		);
		return entries;
	}

	const roleWord = (role: CrewPerson['role']) =>
		role === 'owner' ? 'owner' : role === 'admin' ? 'admin' : 'member';
</script>

<svelte:head>
	<title>{crew?.name ?? 'Crew'} · WattRoom</title>
</svelte:head>

<main class="page">
	{#if error}
		<Banner>{error}</Banner>
	{:else if !crew}
		<Skeleton class="h-8 w-48" />
		<Skeleton class="mt-6 h-40" />
	{:else}
		<header class="flex items-start gap-3">
			<span
				class="bg-ink/5 text-ink/80 grid h-12 w-12 shrink-0 place-items-center rounded-xl"
			>
				{#if crew.icon}
					<RoomIcon icon={crew.icon} size={22} />
				{:else}
					<span class="font-display text-xl font-bold"
						>{crew.name.slice(0, 1).toUpperCase()}</span
					>
				{/if}
			</span>
			<div class="min-w-0 flex-1">
				{#if editing}
					<input
						bind:this={field}
						bind:value={draft}
						maxlength="60"
						class="input font-display w-full max-w-md text-xl font-bold"
						aria-label="crew name"
						onkeydown={(e) => {
							if (e.key === 'Enter') saveName();
							if (e.key === 'Escape') editing = false;
						}}
						onblur={saveName}
					/>
				{:else if administers}
					<button
						onclick={edit}
						disabled={busy}
						class="hover:text-ink flex min-h-11 max-w-full items-center gap-2 text-left"
						title="rename the crew"
					>
						<h1 class="font-display truncate text-2xl font-bold tracking-tight">
							{crew.name}
						</h1>
						<Pencil size={14} class="text-muted shrink-0" aria-hidden="true" />
					</button>
				{:else}
					<h1 class="font-display truncate text-2xl font-bold tracking-tight">
						{crew.name}
					</h1>
				{/if}
				<p class="text-muted text-sm">
					{crew.rooms.length === 1 ? '1 room' : `${crew.rooms.length} rooms`}
					· {crew.people.length === 1
						? '1 person'
						: `${crew.people.length} people`}
					{#if owner}
						· yours
					{:else if crew.role === 'admin'}
						· you admin it
					{/if}
				</p>
			</div>
		</header>

		{#if owner}
			<!-- The day-one card, always reachable here for anyone who
			     dismissed it in the sidebar without reading (#1151). -->
			<div class="mt-6 max-w-sm">
				<CrewIntro id={crew.id} name={crew.name} rooms={crew.rooms.length} />
			</div>
		{/if}

		<h2 class="eyebrow mt-8">rooms</h2>
		<ul class="divide-ink/5 panel mt-2 divide-y">
			{#each crew.rooms as room (room.slug)}
				{@const mark = accessMark(room.access)}
				{@const open = reachable(room.access)}
				<li>
					<svelte:element
						this={open ? 'a' : 'div'}
						href={open ? `/r/${room.slug}` : undefined}
						title={open ? undefined : mark?.label}
						class="flex min-h-11 items-center gap-3 px-4 py-2.5 text-sm {open
							? 'hover:bg-ink/5 text-ink'
							: 'text-muted/60'}"
					>
						<RoomIcon icon={room.icon} size={15} />
						<span class="min-w-0 flex-1 truncate">{room.name}</span>
						{#if mark}
							<mark.icon
								size={13}
								class="text-muted/60 shrink-0"
								aria-label={mark.label}
							/>
							<span class="text-muted/70 hidden text-[11px] sm:inline"
								>{mark.label}</span
							>
						{/if}
					</svelte:element>
				</li>
			{/each}
		</ul>

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
							· since {new Date(person.since).toLocaleDateString(undefined, {
								month: 'short',
								year: 'numeric',
							})}
						</span>
					</span>
					{#if canAct(person)}
						<button
							onclick={() =>
								person.role === 'admin'
									? act(
											person,
											'member',
											`${person.displayName} is a member now.`,
										)
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
								>banned from the crew · {new Date(
									person.since,
								).toLocaleDateString(undefined, {
									month: 'short',
									year: 'numeric',
								})}</span
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
	{/if}
</main>
