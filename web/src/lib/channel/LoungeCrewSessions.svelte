<script lang="ts">
	// The crew's sessions, from the Lounge (#4562): since sessions left the
	// call (#4389) a voice channel showed none of them, so an owner on a
	// phone had no way to end one left running. Each row opens it, and the
	// owner and admins end or cancel somebody else's from here.
	import { api } from '#lib/api.ts';
	import { account } from '#lib/account.svelte.ts';
	import { joinSessionPath, sessionPath } from '#lib/channel/address.ts';
	import { useChannel } from '#lib/channel/context.ts';
	import { confirm } from '#lib/confirm.svelte.ts';
	import { device } from '#lib/device.svelte.ts';
	import { crewLive } from '#lib/nav/crew-live.svelte.ts';
	import { toasts } from '#lib/toast.svelte.ts';
	import type { LiveSession } from '#lib/protocol.ts';
	import Radio from '@lucide/svelte/icons/radio';
	import Square from '@lucide/svelte/icons/square';

	const channel = useChannel();
	const crew = $derived(channel.address.crew);
	// Somebody else's: the coach ends their own from the session's page.
	const sessions = $derived(
		(crewLive.crews.find((c) => c.id === crew)?.sessions ?? []).filter(
			(s) => s.coach !== account.me?.id,
		),
	);
	let ending = $state<string | null>(null);

	/** Not yet ridden: cancelling it saves nothing. */
	const waiting = (s: LiveSession) =>
		s.phase === 'idle' || s.phase === 'countdown';

	async function end(s: LiveSession) {
		const cancel = waiting(s);
		const ok = await confirm(
			cancel
				? {
						title: `Cancel ${s.coachName}'s session?`,
						body: `${s.workout} was never started. Cancelling it frees the crew for another session.`,
						action: 'Cancel the session',
						cancel: 'Keep going',
					}
				: {
						title: `End ${s.coachName}'s session for ${s.riders.length} rider${s.riders.length === 1 ? '' : 's'}?`,
						body: 'What everyone has ridden is saved.',
						action: 'End the session',
						cancel: 'Keep going',
					},
		);
		if (!ok) return;
		ending = s.id;
		const res = await api(`/api/crews/${crew}/sessions/${s.id}/end`, {
			method: 'POST',
			json: {},
		});
		ending = null;
		if (!res.ok) {
			toasts.push(res.error.message, { tone: 'error' });
			return;
		}
		toasts.push(cancel ? `${s.workout} was cancelled.` : `${s.workout} ended.`);
		void crewLive.reload();
	}
</script>

{#if sessions.length > 0}
	<ul class="grid gap-2" aria-label="the crew's sessions">
		{#each sessions as s (s.id)}
			<li class="panel flex flex-wrap items-center gap-2 px-3 py-2">
				<div class="min-w-[12rem] flex-1">
					<p class="truncate text-sm font-medium">
						<Radio size={14} class="text-neon mr-1 inline" />{s.workout}
					</p>
					<p class="text-muted text-xs">
						{s.coachName} coaching · {s.riders.length} riding
					</p>
				</div>
				<a
					href={device.spectator
						? `${sessionPath(crew, s.id)}/watch`
						: joinSessionPath(crew, s.id)}
					class="btn btn-secondary btn-sm"
					>{device.spectator ? 'Watch' : 'Join'}</a
				>
				{#if channel.canManage}
					<button
						onclick={() => void end(s)}
						disabled={ending === s.id}
						class="btn btn-danger btn-sm"
						><Square size={13} />
						{waiting(s) ? 'Cancel session' : 'End session'}</button
					>
				{/if}
			</li>
		{/each}
	</ul>
{/if}
