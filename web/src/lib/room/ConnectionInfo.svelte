<script lang="ts">
	// One rider's connection, as numbers (#2131). Mounted once in the root
	// layout; `connectionInfo.open(id)` from `personMenu` is what raises it.
	//
	// Numbers and nothing else. A rider opening this is diagnosing something —
	// "is it me or is it them" — and a sentence wrapped around a figure is one
	// more thing to read past at arm's length. Label, value, unit.
	//
	// Chrome, not live data (ADR-0005): the ride's watts glow in `--color-watt`
	// and this does not compete with them. Nothing here glows.
	import Modal from '$lib/components/Modal.svelte';
	import { account } from '$lib/account.svelte';
	import { connectionInfo } from '$lib/room/connection-info.svelte';
	import { roomConnection } from '$lib/room/connection.svelte';

	const id = $derived(connectionInfo.riderId);
	const connection = $derived(roomConnection.current);
	const rider = $derived(
		connection?.live.tick?.roster.find((entry) => entry.id === id),
	);
	const you = $derived(!!id && id === account.me?.id);
	// The SFU judges a link it can see. Nobody in voice has one, and `unknown`
	// is LiveKit's own word for "not decided yet" — neither is a tier, so both
	// read as no measurement rather than as a bad one.
	const quality = $derived(id ? connection?.av.quality[id] : undefined);
	const measured = $derived(quality && quality !== 'unknown' ? quality : null);
	// Their ping is the server's own round trip to their best socket, so it
	// exists whether or not they ever joined voice. Zero means not yet
	// measured — the first keepalive of a fresh socket has not come back.
	const ping = $derived(rider?.pingMs ?? 0);
	// What that same socket is running on. Their client's word rather than a
	// measurement, which is why it sits below the two the server owns.
	const DEVICES: Record<string, string> = {
		desktop: 'PC',
		phone: 'Phone',
		tablet: 'Tablet',
	};
	const device = $derived(rider?.device ? DEVICES[rider.device] : undefined);
</script>

{#if id && connection}
	<Modal
		label="connection"
		class="max-w-xs"
		onclose={() => connectionInfo.close()}
	>
		<h2 class="text-ink mb-4 text-sm font-semibold">
			{rider?.name ?? 'This rider'}
		</h2>
		{#if rider}
			<dl class="grid grid-cols-[auto_1fr] items-baseline gap-x-6 gap-y-3">
				<dt class="eyebrow">Ping</dt>
				<dd
					data-testid="connection-ping"
					class="text-ink justify-self-end font-mono text-lg tabular-nums"
					aria-label={ping > 0 ? `${ping} milliseconds` : 'ping not measured'}
				>
					{#if ping > 0}
						{ping}<span class="text-muted text-xs"> ms</span>
					{:else}
						<span class="text-muted">—</span>
					{/if}
				</dd>

				<dt class="eyebrow">Quality</dt>
				<dd
					data-testid="connection-quality"
					class="justify-self-end font-mono text-lg {measured === 'poor' ||
					measured === 'lost'
						? 'text-danger'
						: 'text-ink'}"
				>
					{measured ?? '—'}
				</dd>

				<dt class="eyebrow">Device</dt>
				<dd
					data-testid="connection-device"
					class="text-ink justify-self-end font-mono text-lg"
				>
					{device ?? '—'}
				</dd>

				{#if you}
					<!-- Yours alone (#2131). The server sends this to the socket it
					     belongs to and never puts it on the roster, so there is no
					     other rider's address here to withhold. -->
					<dt class="eyebrow">IP</dt>
					<dd
						data-testid="connection-ip"
						class="text-ink justify-self-end font-mono text-sm break-all"
					>
						{connection.live.ownIp ?? '—'}
					</dd>
				{/if}
			</dl>
			{#if !measured}
				<!-- Capability gating (ux.md): a dash with no reason reads as
				     broken. One line on why, not a sentence about the number. -->
				<p class="text-muted mt-4 text-xs">Quality needs voice.</p>
			{/if}
		{:else}
			<!-- They left while the panel was open; the roster is the truth. -->
			<p class="text-muted text-sm">They have left the room.</p>
		{/if}
	</Modal>
{/if}
