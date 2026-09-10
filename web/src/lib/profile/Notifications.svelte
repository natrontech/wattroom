<script lang="ts">
	// The Notifications section of Settings (#202, ADR-0042; #1330). Four
	// things a browser can say and the section says each of them: on, off,
	// blocked — the rider once pressed Block and no prompt will ever show
	// again — and not supported at all, as on iOS Safari in a tab.
	import { account } from '$lib/account.svelte';
	import { shellVersion } from '$lib/desktop';
	import { notify } from '$lib/notify.svelte';

	// The one email switch (ADR-0030's `notify_planned`) lives here with the
	// other notifications, not in the profile form (#1828). A toggle saves
	// itself (errors.md: undo over confirm); the address it needs is typed in
	// on the profile, and MailAvailable hides the whole thing on a server
	// that cannot send.
	// Only a verified address is ever mailed (ADR-0030; the targets query
	// says so structurally), so the switch waits for the link, not the
	// typing (#1906) — ticked while pending, it saved and nothing arrived.
	const verified = $derived(!!account.me?.emailVerified);
	const pending = $derived(!!account.me?.emailPending && !verified);
	let mailError = $state<string | null>(null);
	async function setPlanned(on: boolean) {
		const me = account.me;
		if (!me) return;
		mailError = null;
		const err = await account.save({
			displayName: me.displayName,
			ftpWatts: me.ftpWatts,
			weightKg: me.weightKg,
			notifyPlanned: on,
		});
		if (err) mailError = err.message;
	}

	let blocked = $state(notify.permission === 'denied');
	async function turnOn() {
		blocked = (await notify.enable()) === 'denied';
	}
	// One you can see (#1440): the switch only promises; this shows.
	let tested = $state(false);
	function sendTest() {
		notify.test();
		tested = true;
	}
</script>

<section class="panel mt-8 p-6">
	<h2 class="font-display font-bold">Notifications</h2>
	<div class="mt-3 flex flex-wrap items-center gap-3">
		<p class="text-muted min-w-56 flex-1 text-sm leading-relaxed">
			{#if !notify.supported}
				This browser cannot show notifications. Add WattRoom to your home
				screen, or use the desktop app, and they work.
			{:else if notify.enabled}
				On. A message, someone arriving, a session starting or a poke reaches
				you while this window is hidden or behind another app.
			{:else if blocked}
				Blocked by this browser: it will not ask again. Allow notifications for
				this site in the browser's site settings, then turn them on here.
			{:else if shellVersion()}
				Off. Nothing reaches you while the app is behind another window.
			{:else}
				Off. Turn it on and this browser asks once for permission.
			{/if}
		</p>
		{#if notify.supported && notify.enabled}
			<button class="btn btn-primary" onclick={sendTest}
				>Send a test notification</button
			>
			<button class="btn btn-secondary" onclick={() => notify.disable()}
				>Turn off</button
			>
		{:else if notify.supported && !blocked}
			<button class="btn btn-primary" onclick={() => void turnOn()}
				>Turn on notifications</button
			>
		{/if}
	</div>
	{#if tested && notify.enabled}
		<p class="text-muted mt-3 text-sm leading-relaxed">
			{#if shellVersion()}
				Sent. If nothing appeared, your system is asking whether to allow
				WattRoom's notifications, or has them switched off in its notification
				settings.
			{:else}
				Sent. If nothing appeared, this browser or your system is blocking
				notifications for this site.
			{/if}
		</p>
	{/if}
	{#if account.me?.mailAvailable}
		<div class="border-ink/5 mt-5 border-t pt-4">
			<span class="eyebrow">email</span>
			<label class="text-muted mt-2 flex items-start gap-2 text-sm">
				<input
					type="checkbox"
					checked={account.me.notifyPlanned ?? false}
					disabled={!verified}
					onchange={(e) => void setPlanned(e.currentTarget.checked)}
					class="mt-1"
				/>
				<span>
					<!-- One switch, four mails (ADR-0030): say so, or a rider
					     signs up for one and gets four. -->
					Email me about sessions in my rooms — planned, moved, cancelled, and an
					hour before
					{#if pending}
						<span class="text-muted block text-xs"
							>Confirm your address first — the link is in your inbox.</span
						>
					{:else if !verified}
						<span class="text-muted block text-xs"
							>Needs a confirmed email address first — add one on <a
								href="/settings/profile"
								class="btn-link">Profile</a
							>.</span
						>
					{/if}
				</span>
			</label>
			{#if mailError}
				<p class="text-danger mt-2 text-xs">{mailError}</p>
			{/if}
		</div>
	{/if}
</section>
