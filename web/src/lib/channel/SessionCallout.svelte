<script lang="ts">
	// A session someone in this call just started (docs/SESSIONS.md): one
	// line with Join, from the start until its count-in ends. Read off the
	// crew's live list and the call's roster; nothing is stored.
	import Radio from '@lucide/svelte/icons/radio';
	import { account } from '$lib/account.svelte';
	import { sessionPath } from '$lib/channel/address';
	import { channelConnection } from '$lib/channel/connection.svelte';
	import { crewLive } from '$lib/nav/crew-live.svelte';

	const call = $derived(channelConnection.call);
	const here = $derived(
		new Set((call?.live.tick?.roster ?? []).map((r) => r.id)),
	);
	const started = $derived(
		(
			crewLive.crews.find((c) => c.id === call?.address.crew)?.sessions ?? []
		).filter(
			(s) =>
				here.has(s.coach) &&
				(s.phase === 'countdown' || s.phase === 'idle') &&
				!s.riderIds.includes(account.me?.id ?? ''),
		),
	);
</script>

{#if call}
	{#each started as session (session.id)}
		<div
			class="panel flex items-center gap-3 px-3 py-2 text-sm"
			data-testid="session-callout"
		>
			<Radio size={16} class="text-neon shrink-0" />
			<span class="min-w-0 flex-1 truncate"
				>{session.coachName} started <strong>{session.workout}</strong></span
			>
			<a
				href={sessionPath(call.address.crew, session.id)}
				class="btn btn-accent btn-sm">Join</a
			>
		</div>
	{/each}
{/if}
