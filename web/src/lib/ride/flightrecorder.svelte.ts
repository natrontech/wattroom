import type { ApiResult } from '$lib/api';
import { api } from '$lib/api';

/**
 * The ride's flight recorder (#52, ADR-0006): a bounded in-memory ring of the
 * last ~120 s — ticks, state transitions, console errors. A mid-ride ⚑ tap
 * stamps a marker with a snapshot; the post-ride card submits each flag as
 * one report. Only the reporter's own telemetry, ever.
 */
const WINDOW_SECONDS = 120;
const MAX_EVENTS = 100;

export interface RecorderTick {
	at: number;
	watts: number;
	cadence: number;
	heartRate: number;
	target: number;
	state: string;
}

export interface Flag {
	clientMs: number;
	note: string;
	snapshot: {
		ticks: RecorderTick[];
		events: { at: number; kind: string; text: string }[];
		errors: { at: number; text: string }[];
	};
}

let consoleHooked = false;

export function createFlightRecorder() {
	let ticks: RecorderTick[] = [];
	let events: { at: number; kind: string; text: string }[] = [];
	let errors: { at: number; text: string }[] = [];
	let flags = $state<Flag[]>([]);

	// One console hook per page: errors are part of what a flag means.
	if (!consoleHooked && typeof window !== 'undefined') {
		consoleHooked = true;
		const original = console.error.bind(console);
		console.error = (...args: unknown[]) => {
			errors = [
				...errors.slice(-19),
				{ at: Date.now(), text: args.map(String).join(' ').slice(0, 500) },
			];
			original(...args);
		};
		window.addEventListener('error', (e) => {
			errors = [
				...errors.slice(-19),
				{ at: Date.now(), text: String(e.message).slice(0, 500) },
			];
		});
	}

	return {
		get flags() {
			return flags;
		},
		tick(next: Omit<RecorderTick, 'at'>) {
			ticks.push({ ...next, at: Date.now() });
			const cutoff = Date.now() - WINDOW_SECONDS * 1000;
			while (ticks.length > 0 && ticks[0].at < cutoff) ticks.shift();
		},
		event(kind: string, text: string) {
			events.push({ at: Date.now(), kind, text: text.slice(0, 200) });
			if (events.length > MAX_EVENTS) events.shift();
		},
		/** The ⚑ tap: marker plus a copy of everything the ring holds now. */
		flag() {
			flags = [
				...flags,
				{
					clientMs: Date.now(),
					note: '',
					snapshot: {
						ticks: [...ticks],
						events: [...events],
						errors: [...errors],
					},
				},
			];
		},
		async submit(
			flag: Flag,
			context: { route: string; trainer: string },
		): Promise<ApiResult<{ issue: string }>> {
			return api<{ issue: string }>('/api/feedback', {
				method: 'POST',
				json: {
					route: context.route,
					note: flag.note,
					firstError: flag.snapshot.errors[0]?.text ?? '',
					clientBuild: import.meta.env.MODE,
					userAgent: navigator.userAgent.slice(0, 200),
					trainer: context.trainer,
					clientMs: flag.clientMs,
					buffer: flag.snapshot,
				},
			});
		},
	};
}
