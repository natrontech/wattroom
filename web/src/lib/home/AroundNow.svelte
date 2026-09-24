<script lang="ts">
	import StatusMark from '$lib/status-line/StatusMark.svelte';
	// Home's "Around right now" (#212): the reason to open the app, which is
	// people — the voice channels in your crews with somebody besides you in
	// them (#1502), each a door into the channel. It reads the crews' live
	// read the sidebar keeps fresh on every lobby ping (#2444), so it costs no
	// fetch of its own and never disagrees with the column beside it.
	import ArrowRight from '@lucide/svelte/icons/arrow-right';
	import RidingBars from '$lib/components/RidingBars.svelte';
	import Skeleton from '$lib/components/Skeleton.svelte';
	import { account } from '$lib/account.svelte';
	import { voiceChannelPath } from '$lib/channels';
	import { crewLive } from '$lib/nav/crew-live.svelte';
	import { presence } from '$lib/presence.svelte';
	import { aroundNow } from './around-now';
	import { revealCrews } from './reveal';

	const around = $derived(aroundNow(crewLive.crews, account.me?.id ?? ''));
	// Where to walk in when nobody is anywhere: the main crew's first voice
	// channel (#2144), else the first one there is.
	const door = $derived.by(() => {
		const main = account.me?.homeCrewId;
		const crews = [...crewLive.crews].sort((a, b) =>
			a.id === main ? -1 : b.id === main ? 1 : 0,
		);
		for (const crew of crews) {
			const channel = crew.channels.find((c) => c.kind === 'voice');
			if (channel) return { crew, channel };
		}
		return null;
	});
	// A crew with no voice channel yet, that the rider may make one in.
	const admined = $derived(
		presence.crews.find((c) => c.role === 'owner' || c.role === 'admin'),
	);
</script>

{#if !crewLive.loaded}
	<!-- Not "nobody's around" while the read is out (#1666). -->
	<div class="border-muted/15 mt-3 rounded-lg border px-5 py-4">
		<Skeleton class="h-4 w-48" />
		<Skeleton class="mt-2 h-3 w-28" />
	</div>
{:else if crewLive.error && crewLive.crews.length === 0}
	<!-- A failed read is not an empty one (errors.md): it says so, with the
	     way to try again. -->
	<p class="text-muted mt-3 text-sm">
		{crewLive.error}
		<button onclick={() => void crewLive.reload()} class="btn-link"
			>Retry</button
		>
	</p>
{:else if around.length > 0}
	<div class="mt-3 grid gap-3">
		{#each around as { crew, channel, others } (channel.id)}
			<a
				href={voiceChannelPath(crew.id, channel.id)}
				class="panel panel-lg hover:border-muted/40 flex items-center gap-4 transition-colors"
			>
				<!-- The bars are the one mark that says a session is running
				     (ADR-0020); standing in a channel is a plain dot, because
				     presence never implies watts (ADR-0012). -->
				{#if channel.session}
					<RidingBars size={12} />
				{:else}
					<span class="bg-z4 h-2.5 w-2.5 shrink-0 rounded-full"></span>
				{/if}
				<div class="min-w-0">
					<!-- Crew first: every crew opens with a Lounge ($lib/whereabouts). -->
					<p class="font-display truncate font-bold">
						{crew.name} · {channel.name}
					</p>
					<!-- Who is in there now, each with their status (ADR-0060). -->
					<p class="text-muted mt-0.5 text-xs">
						{#each others as o, i (o.id)}{i > 0 ? ', ' : ''}{o.name}<StatusMark
								line={o.statusLine}
								size={11}
							/>{/each}
						{#if channel.session}· riding now{/if}
					</p>
				</div>
				<span
					class="bg-ink text-paper ml-auto inline-flex shrink-0 items-center gap-1.5 rounded px-3 py-1.5 text-xs font-semibold"
					>Walk in <ArrowRight size={13} /></span
				>
			</a>
		{/each}
	</div>
{:else if door}
	<p class="text-muted mt-3 text-sm">
		Nobody's around right now. Whoever walks into a voice channel next shows up
		here —
		<a href={voiceChannelPath(door.crew.id, door.channel.id)} class="btn-link"
			>walk into {door.crew.name} · {door.channel.name}</a
		>.
	</p>
{:else if presence.crews.length}
	<p class="text-muted mt-3 text-sm">
		Nobody's around yet — no crew of yours has a voice channel.
		{#if admined}
			<a href="/crew/{admined.id}" class="btn-link"
				>Make one in {admined.name}</a
			>, under voice in its sidebar.
		{:else}
			A crew's owner or an admin makes the first.
		{/if}
	</p>
{:else}
	<p class="text-muted mt-3 text-sm">
		Nobody's around yet — the people you ride with are in a crew.
		<button onclick={revealCrews} class="btn-link"
			>Join one with its code, or start your own</button
		>.
	</p>
{/if}
