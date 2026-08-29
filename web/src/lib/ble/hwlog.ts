/**
 * Fire-and-forget telemetry for hardware sessions. Never throws and never awaits:
 * a logging problem must not disturb a ride, and the rider is on a bike.
 */
export function hwlog(kind: string, data: Record<string, unknown> = {}): void {
	if (!import.meta.env.DEV) return;
	try {
		void fetch('/__hwlog', {
			method: 'POST',
			keepalive: true,
			body: JSON.stringify({ at: new Date().toISOString(), kind, ...data }),
		}).catch(() => {});
	} catch {
		// ignored on purpose
	}
}
