<script lang="ts">
	// A voice channel's live shell (#2449, ADR-0058): ChannelShell on the
	// channel's address — the stage, the tiles, the deck, who is here and the
	// ride. The voice channel's page renders it, and so does a session's
	// (#2450), which runs in one. The crew keeps everything else: roles are
	// the crew's, the plan is its schedule, members and their numbers are its
	// Members page. Voice connects on a tap, never on arrival.
	import { untrack, type Snippet } from 'svelte';
	import Banner from '$lib/components/Banner.svelte';
	import { account } from '$lib/account.svelte';
	import { takeDownAnnouncement } from '$lib/announce/take-down';
	import { setCrewRole } from '$lib/crew';
	import { people } from '$lib/people.svelte';
	import { presence } from '$lib/presence.svelte';
	import { channelAddress } from '$lib/channel/address';
	import ChannelShell from '$lib/channel/ChannelShell.svelte';
	import {
		liveRoleOf,
		loadVoiceChannel,
		type VoiceChannelData,
	} from '$lib/channel/voice-channel';
	import { toasts } from '$lib/toast.svelte';

	let {
		crewId,
		channelId,
		initial,
		children,
	}: {
		crewId: string;
		channelId: string;
		/** What the route's loader already read for this channel. */
		initial: VoiceChannelData;
		children: Snippet;
	} = $props();

	void account.load();

	let view = $state<VoiceChannelData>(untrack(() => initial));
	let loadedFor = $state(untrack(() => `${crewId}/${channelId}`));

	async function load(crew: string, channel: string) {
		const next = await loadVoiceChannel(crew, channel);
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
		view = initial;
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
	// The strip shows the crew's newest (ADR-0058 on 0057); it is taken down
	// in the text channel it was marked in.
	const clearAnnouncement = () =>
		view.announcement &&
		takeDownAnnouncement(
			view.announcement.channelId,
			view.announcement.messageId,
			() => load(crewId, channelId),
		);
	// Planning is the crew's schedule (#2440, #2452), not a channel's.
	const noPlan = () => {
		toasts.push('Plans live on the crew’s schedule.', { tone: 'error' });
		return false;
	};
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
					<!-- The crew itself answering not_found — banned, removed, left
					     — is a way Home, as the text channel's page says it; only
					     a channel gone from a crew that still loads leads back to
					     the crew (#2537). -->
					{#if crew}
						<a href="/crew/{crewId}" class="btn-link text-xs"
							>Back to the crew</a
						>
					{:else}
						<a href="/home" class="btn-link text-xs">Home</a>
					{/if}
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
		<!-- The places carry no visible title — the sidebar names the channel
		     you are standing in (ADR-0020) — so the page's heading is for
		     assistive tech: which channel this is. -->
		<h1 class="sr-only">{channel.name}</h1>
		<ChannelShell
			address={channelAddress(crew.id, channel.id, channel.name)}
			role={liveRoleOf(crew.role)}
			name={channel.name}
			code={crew.code ?? ''}
			cheers={crew.cheers}
			soundPack={channel.soundPack ?? 'base'}
			{members}
			streakWeeks={view.members?.streakWeeks ?? 0}
			together={view.members?.together ?? null}
			board={view.members?.board ?? []}
			onSchedule={noPlan}
			announcement={view.announcement}
			onClearAnnouncement={() => void clearAnnouncement()}
			onRole={setRole}
		>
			{@render children()}
		</ChannelShell>
	{/key}
{/if}
