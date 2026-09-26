// Serves the built SPA and proxies /api to the Go server, so the e2e run exercises
// the same two-process split production uses rather than a mock.
import { spawn } from 'node:child_process';
import { createServer, request as httpRequest } from 'node:http';
import { connect } from 'node:net';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { apiPort, dbDsn, ensureDatabase, webPort } from './env.js';

// Read once, here: this file only ever runs as playwright.config.ts's
// `webServer` command, which exists precisely when the run needs local ports,
// so asking for them is always right by the time we get here (#2126).
const API_PORT = apiPort();
const WEB_PORT = webPort();
const DB_DSN = dbDsn();

const dist = new URL('../build/', import.meta.url).pathname;

ensureDatabase();

/** @type {Record<string, string>} */
const types = {
	'.html': 'text/html',
	'.js': 'text/javascript',
	'.css': 'text/css',
	'.svg': 'image/svg+xml',
	'.woff2': 'font/woff2',
	'.json': 'application/json',
};

const go = spawn('go', ['run', '.'], {
	cwd: new URL('../../server/', import.meta.url).pathname,
	env: {
		...process.env,
		WATTROOM_ADDR: `:${API_PORT}`,
		// No metrics listener for a test run (#1738): nothing scrapes it, and
		// the default port is one more thing for two runs to collide on.
		WATTROOM_METRICS_ADDR: '',
		// The login gate (ADR-0009) means even the e2e ride signs in — the dev
		// provider against a real Postgres, same doors production uses. Which
		// Postgres is env.js's decision: this checkout's own, so a run here
		// cannot write the crews another checkout is asserting about.
		WATTROOM_DB: DB_DSN,
		WATTROOM_DEV_LOGIN: '1',
		// The passkey relying party is derived from this (passkey.go): the
		// ceremony's origin is the page's, which is this proxy, not the API.
		WATTROOM_BASE_URL: `http://localhost:${WEB_PORT}`,
		// AV only turns on with all three set (av.FromEnv) — the same devkey/
		// secret pair make dev-server uses against make infra's LiveKit
		// container. Without these, voice-duck.spec.ts's rider never sees
		// avEnabled and ?voice=1 is a no-op.
		WATTROOM_LIVEKIT_URL:
			process.env.WATTROOM_LIVEKIT_URL ?? 'ws://localhost:7880',
		WATTROOM_LIVEKIT_KEY: process.env.WATTROOM_LIVEKIT_KEY ?? 'devkey',
		WATTROOM_LIVEKIT_SECRET: process.env.WATTROOM_LIVEKIT_SECRET ?? 'secret',
	},
	stdio: 'inherit',
});
process.on('exit', () => go.kill());
for (const signal of ['SIGINT', 'SIGTERM']) {
	process.on(signal, () => {
		go.kill();
		process.exit(0);
	});
}

const web = createServer((req, res) => {
	// req.url is typed optional (it is unset only on a client-side request);
	// falling back to '/' keeps the SPA branch rather than throwing.
	const url = req.url ?? '/';
	if (url.startsWith('/api/')) {
		const upstreamReq = httpRequest(
			{
				host: '127.0.0.1',
				port: API_PORT,
				path: url,
				method: req.method,
				headers: req.headers,
			},
			(upstream) => {
				// An upstream with no status line is the same failure the error
				// handler below reports.
				res.writeHead(upstream.statusCode ?? 502, upstream.headers);
				upstream.pipe(res);
			},
		);
		upstreamReq.on('error', () => {
			res.writeHead(502).end('api unavailable');
		});
		req.pipe(upstreamReq);
		return;
	}

	const [path, query] = url.split('?');
	const requested = normalize(decodeURIComponent(path)).replace(
		/^(\.\.[/\\])+/,
		'',
	);
	// server/spa.go's rules (ADR-0061): "/" is the prerendered landing for a
	// stranger and /enter for a rider, a prerendered page is served for its
	// path, and everything else gets the app's fallback page.
	if (
		requested === '/' &&
		/(?:^|;\s*)wattroom_session=[^;]/.test(req.headers.cookie ?? '')
	) {
		res.writeHead(302, { location: `/enter${query ? `?${query}` : ''}` });
		res.end();
		return;
	}
	let file = join(dist, requested === '/' ? 'index.html' : requested);
	if (!extname(file) && existsSync(`${file}.html`)) file = `${file}.html`;
	if (!existsSync(file) || statSync(file).isDirectory())
		file = join(dist, 'spa.html');
	res.writeHead(200, {
		'content-type': types[extname(file)] ?? 'application/octet-stream',
	});
	createReadStream(file).pipe(res);
});

// A voice channel talks over /ws (live.svelte.ts), so the proxy has to carry
// the upgrade too — an HTTP-only proxy leaves the SPA stuck on its
// lost-connection banner and every channel flow untestable. Raw socket
// piping: the handshake is already a
// complete HTTP request, so it only has to be replayed upstream verbatim.
web.on('upgrade', (req, socket, head) => {
	const upstream = connect(API_PORT, '127.0.0.1', () => {
		const headers = Object.entries(req.headers)
			.map(([name, value]) => `${name}: ${value}\r\n`)
			.join('');
		upstream.write(`${req.method} ${req.url} HTTP/1.1\r\n${headers}\r\n`);
		// Node hands over whatever arrived with the handshake; dropping it loses
		// the client's first frame.
		if (head?.length) upstream.write(head);
		socket.pipe(upstream);
		upstream.pipe(socket);
	});
	const drop = () => {
		socket.destroy();
		upstream.destroy();
	};
	upstream.on('error', drop);
	socket.on('error', drop);
});

// Playwright's readiness probe hits WEB_PORT — only answer once the Go API is
// actually up, so the probe covers both processes and no spec ever races a
// cold `go run` compile.
async function apiReady() {
	for (let attempt = 0; attempt < 240; attempt++) {
		const ok = await new Promise((resolve) => {
			const probe = httpRequest(
				{ host: '127.0.0.1', port: API_PORT, path: '/api/healthz' },
				(res) => resolve(res.statusCode === 200),
			);
			probe.on('error', () => resolve(false));
			probe.end();
		});
		if (ok) return;
		await new Promise((resolve) => setTimeout(resolve, 500));
	}
	throw new Error('go api never became ready');
}

await apiReady();
web.listen(WEB_PORT, () =>
	console.log(`e2e web on :${WEB_PORT}, api on :${API_PORT}`),
);
