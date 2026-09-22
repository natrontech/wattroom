<script lang="ts">
	// A voice channel (#2449, ADR-0058): the room's live shell on the
	// channel's address — the stage, the tiles, the deck, who is here and the
	// ride. The crew keeps everything else: roles are the crew's, the plan is
	// its schedule (#2452), members and their numbers are its Members page.
	// Voice connects on a tap, never on arrival, exactly as a room did.
	import { untrack } from 'svelte';
	import { page } from '$app/state';
	import Banner from '$lib/components/Banner.svelte';
	import { api } from '$lib/api';
	import { account } from '$lib/account.svelte';
	import { fetchCrewChannels } from '$lib/channels';
	import { fetchCrew, fetchCrewMembers, setCrewRole } from '$lib/crew';
	import { people } from '$lib/people.svelte';
	import { presence } from '$lib/presence.svelte';
	import { channelAddress } from '$lib/room/address';
	import RoomShell from '$lib/room/RoomShell.svelte';
	import type { Announcement } from '$lib/room/room-data';
	import {
		liveRoleOf,
		voiceChannelData,
		type VoiceChannelData,
	} from '$lib/room/voice-channel';
	import { toasts } from '$lib/toast.svelte';

	let { children } = $props();

	void account.load();

	const crewId = $derived(page.params.id ?? '');
	const channelId = $derived(page.params.channel ?? '');
	let view = $state<VoiceChannelData>(
		untrack(() => page.data as VoiceChannelData),
	);
	let loadedFor = $state(
		untrack(() => `${page.params.id}/${page.params.channel}`),
	);

	async function load(crew: string, channel: string) {
		const next = voiceChannelData(
			channel,
			...(await Promise.all([
				fetchCrew(crew),
				fetchCrewChannels(crew),
				fetchCrewMembers(crew),
				api<Announcement | undefined>(`/api/crews/${crew}/announcement`),
			])),
		);
		// Only a first load fails loudly: this also runs on every lobby ping,
		// and a hiccup must not blank the channel you are riding in. Being
		// taken out of it severs the socket, which is the signal that matters.
		if (next.error && view.channel && next.errorCode !== 'not_found') return;
		view = next;
	}

	$effect(() => {
		const key = `${crewId}/${channelId}`;
		if (!crewId || !channelId || key === untrack(() => loadedFor)) return;
		loadedFor = key;
		view = page.data as VoiceChannelData;
	});
	// A role, a rename or a gate changes because someone else changed it; the
	// lobby ping is how this client hears (#570).
	let seenVersion = untrack(() => presence.version);
	$effect(() => {
		const version = presence.version;
		if (version === seenVersion) return;
		seenVersion = version;
		if (crewId && channelId) void load(crewId, channelId);
	});

	const crew = $derived(view.crew);
	const channel = $derived(view.channel);
	const members = $derived(
		(crew?.people ?? []).map((p) => ({
			id: p.id,
			displayName: p.displayName,
			avatarUrl: p.avatarUrl,
			role: liveRoleOf(p.role),
		})),
	);
	$effect(() => {
		people.learn(members.map((m) => ({ ...m, name: m.displayName })));
	});

	// The one moderation a tile's menu reaches here is the crew's ban, which
	// is the only ban now (#2442); undoing it is lifting it.
	async function setRole(userId: string, role: string): Promise<boolean> {
		if (!crew) return false;
		const res = await setCrewRole(
			crew.id,
			userId,
			role === 'banned' ? 'banned' : 'member',
		);
		if (!res.ok) {
			toasts.push(res.error.message, { tone: 'error' });
			return false;
		}
		void load(crewId, channelId);
		return true;
	}
	// Planning is the crew's schedule (#2440, #2452), not a channel's.
	const noPlan = () => {
		toasts.push('Plans live on the crew’s schedule.', { tone: 'error' });
		return false;
	};
	const noop = () => {};
</script>

<svelte:head
	><title>{channel?.name ?? 'Voice channel'} · WattRoom</title></svelte:head
>

{#if !crew || !channel}
	<main class="page">
		{#if view.errorCode === 'not_found'}
			<Banner tone="error">
				{view.error}
				{#snippet action()}
					<a
						href={crewId ? `/crew/${crewId}` : '/home'}
						class="btn-link text-xs">Back to the crew</a
					>
				{/snippet}
			</Banner>
		{:else}
			<Banner tone="error">
				{view.error ?? 'The voice channel could not be loaded.'}
				{#snippet action()}
					<button
						onclick={() => void load(crewId, channelId)}
						class="btn-link text-xs">Retry</button
					>
				{/snippet}
			</Banner>
		{/if}
	</main>
{:else}
	<!-- Keyed by the channel: a different channel is a different place, and
	     the shell joins the one it was mounted for. -->
	{#key channel.id}
		<RoomShell
			slug=""
			address={channelAddress(crew.id, channel.id, channel.name)}
			role={liveRoleOf(crew.role)}
			roomName={channel.name}
			icon={crew.icon ?? ''}
			code={crew.code ?? ''}
			soundPack={channel.soundPack ?? 'base'}
			{members}
			crewVisible={!channel.private}
			onGrant={noop}
			onRevoke={noop}
			onTransfer={noop}
			streakWeeks={view.members?.streakWeeks ?? 0}
			together={view.members?.together ?? null}
			board={view.members?.board ?? []}
			upcoming={[]}
			onSchedule={noPlan}
			onReschedule={noop}
			onUnschedule={noop}
			onRsvp={noop}
			icsToken=""
			onRotateIcs={noop}
			announcement={view.announcement}
			onRole={setRole}
			onRemove={noop}
		>
			{@render children()}
		</RoomShell>
	{/key}
{/if}
