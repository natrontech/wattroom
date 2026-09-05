import type { ApiResult } from '$lib/api';
import { api } from '$lib/api';

/**
 * The ride's flight recorder (#52, ADR-0006): a bounded in-memory ring of the
 * last ~120 s — ticks, state transitions, console errors, unhandled rejections.
 * A mid-ride ⚑ tap stamps a marker with a snapshot; the post-ride card submits
 * each flag as one report. Only the reporter's own telemetry, ever — and never
 * heart rate: a report ends up in a public issue, and HR is health data
 * (WATTROOM.md, ADR-0008).
 */
const WINDOW_SECONDS = 120;
const MAX_EVENTS = 100;
const MAX_ERRORS = 20;
const MAX_ERROR_CHARS = 500;

export interface RecorderTick {
	at: number;
	watts: number;
	cadence: number;
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

/**
 * Errors are page-wide, not per recorder: the hooks below bind once per page,
 * and a ride screen mounted a second time must still see what broke before it.
 */
let errors: { at: number; text: string }[] = [];
let hooked = false;

function recordError(text: string) {
	errors = [
		...errors.slice(-(MAX_ERRORS - 1)),
		{ at: Date.now(), text: text.slice(0, MAX_ERROR_CHARS) },
	];
}

/**
 * A rejection reason is whatever was thrown: an Error, a string, undefined, an
 * object without a toString worth reading. Keep the name and message where there
 * is one, and never let the stringifying itself throw.
 */
export function describeReason(reason: unknown): string {
	if (reason instanceof Error) {
		const head = `${reason.name}: ${reason.message}`;
		if (!reason.stack) return head;
		return reason.stack.startsWith(head)
			? reason.stack
			: `${head}\n${reason.stack}`;
	}
	if (typeof reason === 'string') return reason;
	try {
		return JSON.stringify(reason) ?? String(reason);
	} catch {
		return String(reason);
	}
}

export function createFlightRecorder() {
	let ticks: RecorderTick[] = [];
	let events: { at: number; kind: string; text: string }[] = [];
	let flags = $state<Flag[]>([]);

	// One set of hooks per page: errors are part of what a flag means. A rejected
	// promise from a fetch or a goto raises `unhandledrejection`, not `error`, and
	// is the SPA's most common failure — without this hook it left no trace (#668).
	if (!hooked && typeof window !== 'undefined') {
		hooked = true;
		const original = console.error.bind(console);
		console.error = (...args: unknown[]) => {
			recordError(args.map(String).join(' '));
			original(...args);
		};
		window.addEventListener('error', (e) => recordError(String(e.message)));
		window.addEventListener('unhandledrejection', (e) =>
			recordError(`unhandled rejection: ${describeReason(e.reason)}`),
		);
	}

	return {
		get flags() {
			return flags;
		},
		/** Picks its fields by name: a spread sample carries heart rate, the ring must not. */
		tick(next: Omit<RecorderTick, 'at'>) {
			ticks.push({
				at: Date.now(),
				watts: next.watts,
				cadence: next.cadence,
				target: next.target,
				state: next.state,
			});
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
