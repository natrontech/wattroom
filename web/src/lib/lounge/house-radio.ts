/**
 * House radio's sound (ADR-0094): the station's score, played on this
 * machine's AudioContext at server time. Mixed quiet and clean — the first
 * cut was too hot and the drum bus saturated (Dave, 2026-10-31) — and lofi
 * only through a low-pass and a tape wobble.
 */
import {
	SLOT_SEC,
	barNotes,
	sectionOf,
	tuneOf,
	type Note,
	type Style,
	type Tune,
} from '$lib/lounge/station';
import { bass, lead } from '$lib/lounge/radio-voices';
import { organ, pad, piano, pluck } from '$lib/lounge/radio-keys';
import { brush, hat, kick, rim, snare } from '$lib/lounge/radio-drums';
import {
	chipBass,
	chipHat,
	chipKick,
	chipLead,
	chipSnare,
	pulse,
} from '$lib/lounge/radio-chip';
import { OPEN_HZ, build, type Graph } from '$lib/lounge/radio-graph';

/** How far ahead the scheduler lays notes down, in seconds. */
const AHEAD_SEC = 0.15;
/** The tone control's breakdown setting; open is the graph's. */
const SHUT_HZ = 1500;

/** Section changes the sound follows: fades between tunes, the breakdown's low-pass. */
function automate(g: Graph, tune: Tune, bar: number, t: number) {
	const lp = g.toneFilter.frequency;
	const tg = g.tuneGain.gain;
	if (bar === 0) {
		tg.cancelScheduledValues(t);
		tg.setValueAtTime(0.0001, t);
		tg.exponentialRampToValueAtTime(1, t + tune.barSec);
		g.echo.delayTime.setValueAtTime((0.75 * 60) / tune.bpm, t);
		g.space.gain.setTargetAtTime(tune.space, t, 0.5);
		lp.cancelScheduledValues(t);
		lp.setValueAtTime(900, t);
		lp.exponentialRampToValueAtTime(tune.open, t + tune.barSec * 4);
	}
	if (bar === tune.bars - 2) {
		tg.setValueAtTime(1, t);
		tg.exponentialRampToValueAtTime(0.0001, t + tune.barSec * 2);
	}
	const now = sectionOf(tune, bar);
	const before = sectionOf(tune, bar - 1);
	if (now === 'breakdown' && before !== 'breakdown') {
		lp.setValueAtTime(tune.open, t);
		lp.exponentialRampToValueAtTime(SHUT_HZ, t + tune.barSec);
	}
	if (now !== 'breakdown' && before === 'breakdown') {
		lp.setValueAtTime(SHUT_HZ, t);
		lp.exponentialRampToValueAtTime(tune.open, t + tune.barSec / 2);
	}
}

/** One note of the score in the tune's instruments. */
function sound(g: Graph, tune: Tune, n: Note, t: number, dur: number) {
	const { midi, vel } = n;
	switch (n.part) {
		case 'keys':
			// Ambient's pads never rest, so they sit lower to meet the other styles.
			if (tune.keys === 'pad')
				return pad(g, midi, t, dur, tune.style === 'ambient' ? 0.55 : 1);
			if (tune.keys === 'organ') return organ(g, midi, t, dur * 0.9);
			if (tune.keys === 'pluck') return pluck(g, midi, t, vel);
			if (tune.keys === 'pulse')
				return void pulse(g, midi, t, dur * 0.7, 0.02 * vel, 0.25, g.keys);
			return piano(g, midi, t, vel, dur);
		case 'bass':
			if (tune.bass === 'tri') return chipBass(g, midi, t, dur, vel);
			return bass(g, tune.bass, midi, t, dur, vel);
		case 'lead':
			if (tune.lead === 'pulse') return chipLead(g, midi, t, dur * 0.9, vel);
			return lead(g, tune.lead, midi, t, dur * 0.9, vel);
		case 'chime':
			return lead(g, 'bell', midi, t, dur, vel * 0.8);
		case 'kick':
			if (tune.kit === 'chip') return chipKick(g, t, vel);
			return kick(g, t, tune.kit === 'brush' ? vel * 0.7 : vel);
		case 'snare':
			if (tune.kit === 'chip') return chipSnare(g, t, vel);
			if (tune.kit === 'brush') return brush(g, t, vel);
			if (tune.kit === 'rim') return rim(g, t, vel);
			return snare(g, t, vel);
		case 'hat':
		case 'open':
			if (tune.kit === 'chip') return chipHat(g, t, vel, n.part === 'open');
			return hat(g, t, vel, n.part === 'open');
	}
}

/** One sixteenth of one bar: the score's notes on it, swung. */
export function playStep(
	g: Graph,
	tune: Tune,
	bar: number,
	s: number,
	at: number,
	notes: Note[],
) {
	if (s === 0 && at >= g.ctx.currentTime) automate(g, tune, bar, at);
	const beat = 60 / tune.bpm;
	const lean =
		s % 4 === 2
			? (tune.swing - 0.5) * beat
			: s % 2
				? (tune.swing - 0.5) * beat * 0.5
				: 0;
	const sixteenth = tune.barSec / 16;
	for (const n of notes) {
		const t = at + lean + n.nudge;
		if (n.s === s && t >= g.ctx.currentTime)
			sound(g, tune, n, t, n.len * sixteenth);
	}
}

/**
 * One station on this machine. `serverNowMs` is the jukebox's clock, so the
 * bar it plays is the bar every other screen plays.
 */
export function createHouseRadio(station: string, serverNowMs: () => number) {
	let g: Graph | null = null;
	let timer: ReturnType<typeof setInterval> | undefined;
	/** Server seconds minus the audio clock. */
	let offset = 0;
	let cursor = { slot: 0, bar: 0, s: 0 };
	let written = { slot: -1, bar: -1, notes: [] as Note[] };
	/** The style the channel picked, '' for the mix. */
	let pick: Style | '' = '';

	function seat() {
		if (!g) return;
		offset = serverNowMs() / 1000 - g.ctx.currentTime;
		const at = g.ctx.currentTime + offset + 0.05;
		let slot = Math.floor(at / SLOT_SEC);
		const tune = tuneOf(station, slot, pick);
		const into = at - slot * SLOT_SEC;
		let bar = Math.floor(into / tune.barSec);
		let s = Math.ceil((into - bar * tune.barSec) / (tune.barSec / 16));
		if (s >= 16) [bar, s] = [bar + 1, 0];
		if (bar >= tune.bars) [slot, bar, s] = [slot + 1, 0, 0];
		cursor = { slot, bar, s };
	}

	function schedule() {
		if (!g) return;
		// The server-clock estimate settles over the first ticks; follow it
		// when it moves by more than a nudge rather than drift from it.
		if (Math.abs(serverNowMs() / 1000 - g.ctx.currentTime - offset) > 0.05)
			seat();
		const horizon = g.ctx.currentTime + offset + AHEAD_SEC;
		for (;;) {
			const tune = tuneOf(station, cursor.slot, pick);
			const at =
				cursor.slot * SLOT_SEC +
				cursor.bar * tune.barSec +
				(cursor.s * tune.barSec) / 16;
			if (at > horizon) break;
			if (written.slot !== cursor.slot || written.bar !== cursor.bar)
				written = { ...cursor, notes: barNotes(tune, cursor.bar) };
			playStep(g, tune, cursor.bar, cursor.s, at - offset, written.notes);
			if (++cursor.s === 16) {
				cursor.s = 0;
				if (++cursor.bar >= tune.bars)
					cursor = { slot: cursor.slot + 1, bar: 0, s: 0 };
			}
		}
	}

	return {
		/** Start, or keep, playing. Safe to call again. */
		start() {
			if (!g) g = build(new AudioContext());
			void g.ctx.resume();
			if (timer) return;
			seat();
			const now = g.ctx.currentTime;
			g.tuneGain.gain.cancelScheduledValues(now);
			g.tuneGain.gain.setValueAtTime(1, now);
			g.toneFilter.frequency.cancelScheduledValues(now);
			g.toneFilter.frequency.setValueAtTime(OPEN_HZ, now);
			timer = setInterval(schedule, 25);
		},
		/** Stop laying down notes; what is already scheduled rings out under the fader. */
		stop() {
			clearInterval(timer);
			timer = undefined;
		},
		/** The fader times the duck, 0–1, gliding over `ms`. */
		setLevel(value: number, ms = 0) {
			if (!g) return;
			const now = g.ctx.currentTime;
			g.level.gain.cancelScheduledValues(now);
			g.level.gain.setTargetAtTime(value, now, Math.max(0.01, ms / 3000));
		},
		/** The channel picked a style: the next sixteenth plays it, on every screen alike. */
		setStyle(next: Style | '') {
			if (next === pick) return;
			pick = next;
			written = { slot: -1, bar: -1, notes: [] };
			seat();
		},
		setRain(on: boolean) {
			g?.rain.gain.setTargetAtTime(on ? 0.012 : 0, g.ctx.currentTime, 0.6);
		},
		/** Resume after the browser held the context back for want of a gesture. */
		resume() {
			void g?.ctx.resume();
		},
		close() {
			clearInterval(timer);
			timer = undefined;
			void g?.ctx.close();
			g = null;
		},
	};
}

export type HouseRadio = ReturnType<typeof createHouseRadio>;
