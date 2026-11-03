// OpenBikeControl over the network (#3336, ADR-0084 "Inputs"). BikeControl
// on this same computer cannot reach the app over Bluetooth, but it also
// serves OBC on a TCP socket it announces as _openbikecontrol._tcp (MDNS.md,
// github.com/OpenBikeControl/openbikecontrol-protocol, MIT, read for the spec
// only). A page can neither browse mDNS nor open a socket, so the shell does
// both and is a pipe: bytes from the controller to the page, and the two
// messages an app may send back. What a button means is the web app's
// (web/src/lib/ble/obc.ts); the shell never learns it.
//
// The page names a controller only by the instance the shell heard
// announced, so remote content never chooses a host or a port to connect to.
//
// macOS 15 asks before an app talks to the local network (Info.plist's
// NSLocalNetworkUsageDescription and NSBonjourServices, package.json). A
// refusal surfaces as EHOSTUNREACH on the query, and the page says where to
// allow it instead of offering a button that would fail.

const net = require('node:net');
const makeMdns = require('multicast-dns');

const SERVICE = '_openbikecontrol._tcp.local';
// Ask again this often; a controller that misses three answers is gone.
const QUERY_MS = 10_000;
const GONE_MS = 3 * QUERY_MS + 5_000;
const CONNECT_MS = 5_000;
// App to device: Haptic Feedback (0x03, 4 bytes) and App Information (0x04,
// at most 2 + 33 + 33 + 256 bytes). Nothing else goes down the socket.
const SENDS = new Set([0x03, 0x04]);
const MAX_SEND = 324;

let mdns = null;
let denied = false;
/** instance name → { name, port, target, seen } */
const instances = new Map();
/** host name → IPv4 address */
const addresses = new Map();
/** The pages browsing, told on every change. */
const watchers = new Set();
let told = '';

/** The one socket, and the page it reports to. */
let link = null;
/** Pages whose going away is already watched, so a reconnect adds no listener. */
const hooked = new WeakSet();

function hook(contents) {
	if (hooked.has(contents)) return;
	hooked.add(contents);
	contents.once('destroyed', () => {
		watchers.delete(contents);
		if (link?.contents === contents) close();
	});
}

const label = (instance) => instance.slice(0, -SERVICE.length - 1);
// mDNS names are case-insensitive; the maps are keyed in lower case.
const key = (name) => String(name).toLowerCase();

/** What the page sees: every controller with an address, and the refusal. */
function view() {
	const devices = [];
	for (const [id, i] of instances)
		if (i.port && addresses.has(i.target)) devices.push({ id, name: i.name });
	return { devices, denied };
}

function tell() {
	const now = JSON.stringify(view());
	if (now === told) return;
	told = now;
	for (const contents of watchers)
		if (!contents.isDestroyed()) contents.send('wattroom:obc-found', view());
}

function txtName(data) {
	for (const entry of [].concat(data ?? [])) {
		const text = Buffer.from(entry).toString('utf8');
		if (text.startsWith('name=')) return text.slice(5);
	}
	return null;
}

/**
 * One mDNS response: what it says about our service, kept across packets.
 * Every response on the network arrives here; only ours are kept.
 */
function take(packet) {
	const now = Date.now();
	const records = [...(packet.answers ?? []), ...(packet.additionals ?? [])];
	let ours = false;
	for (const r of records)
		if (r.type === 'PTR' && key(r.name) === SERVICE) {
			ours = true;
			if (r.ttl === 0) instances.delete(key(r.data));
			else {
				const i = instances.get(key(r.data)) ?? { name: label(r.data) };
				i.seen = now;
				instances.set(key(r.data), i);
			}
		}
	for (const r of records) {
		const i = instances.get(key(r.name));
		if (!i) continue;
		ours = true;
		if (r.type === 'SRV') Object.assign(i, { port: r.data.port, target: key(r.data.target) });
		if (r.type === 'TXT') i.name = txtName(r.data) ?? i.name;
	}
	const targets = new Set([...instances.values()].map((i) => i.target));
	for (const r of records)
		if (r.type === 'A' && targets.has(key(r.name))) {
			ours = true;
			addresses.set(key(r.name), r.data);
		}
	if (!ours) return;
	// A responder that left the address or the port out is asked for it.
	for (const [id, i] of instances) {
		if (!i.port) query([{ name: id, type: 'SRV' }, { name: id, type: 'TXT' }]);
		else if (!addresses.has(i.target)) query([{ name: i.target, type: 'A' }]);
	}
	tell();
}

function query(questions) {
	mdns?.query(questions, (err) => {
		const was = denied;
		// macOS answers a refused Local Network with "no route to host".
		denied = process.platform === 'darwin' && err?.code === 'EHOSTUNREACH';
		if (err && !denied) console.warn('obc: mdns query:', err.code ?? err.message);
		if (denied !== was) {
			if (denied) console.warn('obc: Local Network refused');
			tell();
		}
	});
}

function ask() {
	const stale = Date.now() - GONE_MS;
	for (const [id, i] of instances) if (i.seen < stale) instances.delete(id);
	query([{ name: SERVICE, type: 'PTR' }]);
	tell();
}

/** A page wants the list: start browsing, once, and tell it now. */
function browse(contents) {
	watchers.add(contents);
	hook(contents);
	if (!mdns) {
		mdns = makeMdns();
		mdns.on('response', take);
		mdns.on('error', (err) => console.warn('obc: mdns:', err.code ?? err.message));
		// A membership that fails on one interface is retried every 5 s: say each once.
		const said = new Set();
		mdns.on('warning', (err) => {
			const text = `${err.code ?? ''} ${err.message}`;
			if (said.has(text)) return;
			said.add(text);
			console.warn('obc: mdns:', text);
		});
		ask();
		setInterval(ask, QUERY_MS).unref();
	}
	contents.send('wattroom:obc-found', view());
}

function close() {
	const was = link;
	link = null;
	was?.socket.destroy();
}

/**
 * Open the socket to an announced controller. Resolves `{ name }`, or
 * `{ error }` as a sentence for the rider: an invoke that throws reaches
 * the page wrapped in Electron's own words.
 */
function connect(contents, id) {
	close();
	const i = instances.get(id);
	const host = i && addresses.get(i.target);
	if (!host || !i.port)
		return Promise.resolve({
			error: 'That shifter is gone from the network. Open BikeControl, then try again.',
		});
	return new Promise((resolve) => {
		const socket = net.connect({ host, port: i.port });
		const mine = { socket, contents, open: false };
		link = mine;
		socket.setNoDelay(true);
		socket.setTimeout(CONNECT_MS, () => socket.destroy(new Error('timed out')));
		socket.once('connect', () => {
			mine.open = true;
			socket.setTimeout(0);
			// A peer that vanished without a FIN is noticed, not waited on.
			socket.setKeepAlive(true, 5_000);
			resolve({ name: i.name });
		});
		socket.on('data', (chunk) => {
			if (link === mine && !contents.isDestroyed())
				contents.send('wattroom:obc-data', new Uint8Array(chunk));
		});
		socket.on('error', (err) => {
			if (mine.open) return;
			const refused = process.platform === 'darwin' && err.code === 'EHOSTUNREACH';
			resolve({
				error: refused
					? 'Allow Local Network for WattRoom in System Settings, then try again.'
					: `${i.name} did not answer. Check BikeControl is open, then try again.`,
			});
		});
		socket.on('close', () => {
			if (link !== mine) return;
			link = null;
			// Only a link that was up reports a drop: a failed connect has
			// already answered, and the page retries on its own.
			if (mine.open && !contents.isDestroyed()) contents.send('wattroom:obc-closed');
		});
		hook(contents);
	});
}

/** One message from the page, only to its own socket, and only of a kind an app sends. */
function write(contents, bytes) {
	if (!link?.open || link.contents !== contents) return;
	if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > MAX_SEND) return;
	if (!SENDS.has(bytes[0])) return;
	link.socket.write(bytes);
}

/** Wired in by main.js, whose `ipc` answers only our own page. */
function install({ ipc }) {
	ipc.on('wattroom:obc-browse', (event) => browse(event.sender));
	ipc.handle('wattroom:obc-connect', (event, id) =>
		typeof id === 'string' ? connect(event.sender, id) : { error: 'No shifter named.' },
	);
	ipc.on('wattroom:obc-write', (event, bytes) => write(event.sender, bytes));
	ipc.on('wattroom:obc-close', (event) => {
		if (link?.contents === event.sender) close();
	});
}

module.exports = { install, SERVICE };
