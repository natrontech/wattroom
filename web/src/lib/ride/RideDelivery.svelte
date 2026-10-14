<script lang="ts">
	// Where a ride was sent (#799): a rider who turned auto-upload on has had
	// no way to know whether the ride actually arrived. Delivery is durable
	// now, so the page can simply say.
	import { api } from '$lib/api';
	import type { RideExport } from '$lib/ride/detail';

	let {
		id,
		delivery,
		onRetried,
	}: {
		id: string;
		delivery: RideExport;
		/** The retry was queued; the page reloads the ride to show it. */
		onRetried: () => Promise<void>;
	} = $props();

	// #1158. A delivery that ran out of attempts used to be a dead row and a
	// sentence blaming a disconnection that had usually not happened. This is
	// the one big button errors.md asks for; the server's own sweep does the
	// rest, so there is no second delivery path.
	let retrying = $state(false);
	let retryError = $state<string | null>(null);
	async function retryExport() {
		retrying = true;
		retryError = null;
		const res = await api(`/api/rides/${encodeURIComponent(id)}/export/retry`, {
			method: 'POST',
		});
		if (res.ok) await onRetried();
		else retryError = res.error.message;
		retrying = false;
	}
</script>

<section class="mt-3">
	<h2 class="eyebrow">where it went</h2>
	<p class="panel text-muted mt-3 text-xs">
		{#if delivery.state === 'delivered'}
			<!-- {' '}: Svelte trims a block's leading whitespace, so the
			     newline before "as" vanished and the sentence read "On
			     Stravaas activity …" on every exported ride (#1532). The
			     space cannot live outside the block — there is none to
			     spare before the full stop when there is no id. -->
			On Strava{#if delivery.remoteId}{' '}as
				<a
					class="underline"
					href="https://www.strava.com/activities/{delivery.remoteId}"
					target="_blank"
					rel="noreferrer noopener">activity {delivery.remoteId}</a
				>{/if}.
			{#if delivery.staleSince}
				<!-- #2281: the ride grew after it was delivered, and the
				     copy on Strava never catches up — StartRideExport will
				     not re-open a delivered row, and re-posting is refused
				     as a duplicate. Saying so is the whole fix; replacing
				     the activity would mean deleting it, and its kudos and
				     comments with it. -->
				<span class="mt-2 block">
					This ride grew after it was sent: a late reconnect added the rest of
					it here, and Strava still has the shorter version. WattRoom will not
					replace the activity — that would take its kudos and comments with it
					— so export the FIT above and add it to Strava yourself if you want
					the whole ride there.
				</span>
			{/if}
		{:else if delivery.state === 'pending'}
			Waiting to reach Strava — it is retried on its own, nothing to do.
		{:else}
			<!-- The cause is almost always Strava being briefly away,
			     not a disconnection — so the copy no longer guesses at
			     one, and the action it offers is the one that helps. -->
			Could not be sent to Strava — it was tried several times over a couple of hours.
			Your ride is safe here.
			<button
				onclick={retryExport}
				disabled={retrying}
				class="btn btn-secondary btn-xs mt-2 block"
				>{retrying ? 'Queueing…' : 'Try sending it again'}</button
			>
			{#if retryError}
				<span class="text-danger mt-2 block">{retryError}</span>
			{/if}
		{/if}
	</p>
</section>
