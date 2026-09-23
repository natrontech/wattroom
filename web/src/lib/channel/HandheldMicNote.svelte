<script lang="ts">
	// What stands where the gate's controls do on a handheld (#2142,
	// docs/SPEC.md). There is no gate there to pick a mode for or to tune: the
	// chain publishes the capture as it comes, because holding one open is
	// what puts the call on a phone's earpiece — so the mic button is the
	// gate, and every surface that would draw a slider over a meter that can
	// never move says this instead (ux.md: no control that cannot work).
	//
	// One copy, two surfaces: the Sound panel and Settings → Voice &
	// audio. They draw the gate itself differently — buttons at 160 bpm
	// against a desk's radios — but there is only one thing to say here, and
	// two copies of it would drift.
</script>

<p class="text-muted mt-1.5 text-xs">
	The mic button is your gate here. A phone plays the call through its earpiece
	while anything is capturing, so the mic opens when you tap it and the
	loudspeaker comes back when you tap it again.
</p>
