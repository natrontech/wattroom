<script lang="ts">
	// A crew's own session (docs/SESSIONS.md): ChannelShell on the session's
	// address, with no call in it. The crew is the session's: its people, its
	// roles, its plans. There is no voice channel behind it, so no deck, no
	// announcement strip and no plan of a channel's.
	import { untrack, type Snippet } from 'svelte';
	import Banner from '$lib/components/Banner.svelte';
	import { account } from '$lib/account.svelte';
	import { fetchCrew, learnCrewFaces, setCrewRole, type Crew } from '$lib/crew';
	import { planCrewSession } from '$lib/crew-schedule';
	import { provideCrewEmoji } from '$lib/emoji/crew-emoji.svelte';
	import { crewSessionAddress } from '$lib/channel/address';
	import ChannelShell from '$lib/channel/ChannelShell.svelte';
	import { liveRoleOf } from '$lib/channel/voice-channel';
	import type { LiveSession } from '$lib/protocol';
	import { toasts } from '$lib/toast.svelte';

	let {
		crewId,
		session,
		children,
	}: { crewId: string; session: LiveSession; children: Snippet } = $props();

	provideCrewEmoji(() => crewId);
	void account.load();

	let crew = $state<Crew | null>(null);
	let error = $state<string | null>(null);
	async function load(id: string) {
		const res = await fetchCrew(id);
		if (id !== untrack(() => crewId)) return;
		if (res.ok) crew = res.data;
		else error = res.error.message;
	}
	$effect(() => void load(crewId));
	$effect(() => learnCrewFaces(crew?.people));

	const members = $derived(
		(crew?.people ?? []).map((p) => ({
			id: p.id,
			displayName: p.displayName,
			avatarUrl: p.avatarUrl,
			role: liveRoleOf(p.role),
			statusLine: p.statusLine,
		})),
	);

	async function setRole(userId: string, role: string): Promise<boolean> {
		const res = await setCrewRole(
			crewId,
			userId,
			role === 'banned' ? 'banned' : 'member',
		);
		if (!res.ok) {
			toasts.push(res.error.message, { tone: 'error' });
			return false;
		}
		void load(crewId);
		return true;
	}

	// A plan made here is the crew's, in no channel.
	async function plan(
		workoutName: string,
		workoutJson: string,
		startsAt: string,
	) {
		const res = await planCrewSession(crewId, {
			workoutName,
			workoutJson,
			startsAt,
		});
		if (!res.ok) return res.error.message;
		toasts.push('Planned — it is on the crew’s schedule.', {
			href: `/crew/${crewId}/schedule`,
		});
	}
</script>

<svelte:head><title>{session.workout} · WattRoom</title></svelte:head>

{#if error}
	<main class="page">
		<Banner tone="error">
			{error}
			{#snippet action()}
				<a href="/crew/{crewId}" class="btn-link text-xs">Back to the crew</a>
			{/snippet}
		</Banner>
	</main>
{:else if crew}
	{#key session.id}
		<h1 class="sr-only">{session.workout}</h1>
		<ChannelShell
			address={crewSessionAddress(crew.id, session.id, session.workout)}
			role={liveRoleOf(crew.role)}
			name={session.workout}
			crewName={crew.name}
			code={crew.code ?? ''}
			soundPack="base"
			{members}
			onSchedule={plan}
			plan={null}
			onPlanChanged={() => {}}
			announcement={null}
			onClearAnnouncement={() => {}}
			onRole={setRole}
		>
			{@render children()}
		</ChannelShell>
	{/key}
{/if}
