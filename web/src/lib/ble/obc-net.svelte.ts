/**
 * OpenBikeControl over the network, in the desktop shell (#3336, ADR-0084
 * "Inputs"). BikeControl on the same computer cannot reach WattRoom over
 * Bluetooth, but it also serves OBC on a TCP socket it announces as
 * `_openbikecontrol._tcp` (MDNS.md). A page can neither browse mDNS nor open
 * a socket, so the shell does both and passes bytes; what they mean stays
 * here, decoded by the same `obc.ts` as the Web Bluetooth controller.
 *
 * In a browser there is no `window.wattroom.obc`: `available` is false and
 * nothing below runs.
 */
import type { Controller } from './controller';
import {
	WATTROOM_APP_INFO,
	createObcButtons,
	decodeObcStream,
	encodeHaptic,
	type ObcAction,
	type ObcEdge,
} from './obc';
import { createReattach } from './reattach';
import type { SensorStatus } from './sensor';

/** A controller the shell heard announce itself on the network. */
export interface NetShifter {
	id: string;
	name: string;
}

/** The shell's bridge (desktop/preload.js `obc`). */
export interface ObcNetBridge {
	/** `cb` hears what the shell finds, now and on every change. */
	browse(cb: (found: { devices: NetShifter[]; denied: boolean }) => void): void;
	/** Opens the one socket; `error` is a sentence for the rider. */
	connect(id: string): Promise<{ name?: string; error?: string }>;
	onData(cb: (bytes: Uint8Array) => void): void;
	onClosed(cb: () => void): void;
	write(bytes: Uint8Array): void;
	close(): void;
}

function bridge(): ObcNetBridge | undefined {
	return (globalThis as { wattroom?: { obc?: ObcNetBridge } }).wattroom?.obc;
}

let found = $state.raw<NetShifter[]>([]);
let denied = $state(false);
let started = false;
/** The live controller's ends of the socket; the shell holds one socket. */
let current: { data(bytes: Uint8Array): void; closed(): void } | undefined;

export const obcNet = {
	/** This page runs in a shell that can reach the network. */
	get available() {
		return !!bridge();
	},
	/** Controllers on the network now. */
	get found() {
		return found;
	},
	/** macOS refused the Local Network permission. */
	get denied() {
		return denied;
	},
	/** Ask the shell to browse. Idempotent, and silent in a browser. */
	start() {
		const shell = bridge();
		if (started || !shell) return;
		started = true;
		shell.onData((bytes) => current?.data(bytes));
		shell.onClosed(() => current?.closed());
		shell.browse((next) => {
			found = Array.isArray(next?.devices) ? next.devices : [];
			denied = next?.denied === true;
		});
	},
};

export function createObcNetController(
	shifter: NetShifter,
	shell: ObcNetBridge | undefined = bridge(),
): Controller {
	let status: SensorStatus = 'disconnected';
	/** Set on rider-initiated disconnect, so the retry loop stands down. */
	let closed = false;
	const actionCbs = new Set<(action: ObcAction, edge: ObcEdge) => void>();
	const statusCbs = new Set<(s: SensorStatus) => void>();
	const buttons = createObcButtons((action, edge) => {
		for (const cb of actionCbs) cb(action, edge);
	});
	const ends = {
		data(bytes: Uint8Array) {
			for (const message of decodeObcStream(bytes)) buttons.take(message);
		},
		closed() {
			buttons.drop();
			if (closed) return;
			setStatus('connecting');
			retry.schedule();
		},
	};

	function setStatus(next: SensorStatus) {
		status = next;
		for (const cb of statusCbs) cb(next);
	}

	async function attach(): Promise<void> {
		const answer = await shell!.connect(shifter.id);
		if (answer?.error) throw new Error(answer.error);
		if (closed) return shell!.close();
		// MDNS.md: right after the connection, which clears it on close.
		shell!.write(WATTROOM_APP_INFO);
		retry.reset();
		setStatus('connected');
	}

	const retry = createReattach(
		() => attach(),
		() => closed || status === 'connected',
	);

	return {
		name: shifter.name,
		get status() {
			return status;
		},

		async connect() {
			if (!shell)
				throw new Error('Network shifters need the WattRoom desktop app');
			closed = false;
			current = ends;
			setStatus('connecting');
			try {
				await attach();
			} catch (cause) {
				setStatus('disconnected');
				throw cause;
			}
		},

		async disconnect() {
			closed = true;
			buttons.drop();
			if (current === ends) {
				current = undefined;
				shell?.close();
			}
			setStatus('disconnected');
		},

		onAction(cb) {
			actionCbs.add(cb);
			return () => actionCbs.delete(cb);
		},
		onStatus(cb) {
			statusCbs.add(cb);
			return () => statusCbs.delete(cb);
		},

		feel(feel) {
			if (status === 'connected') shell?.write(encodeHaptic(feel));
		},
	};
}
