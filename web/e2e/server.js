// Serves the built SPA and proxies /api to the Go server, so the e2e run exercises
// the same two-process split production uses rather than a mock.
import { spawn } from 'node:child_process';
import { createServer, request as httpRequest } from 'node:http';
import { connect } from 'node:net';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';

const WEB_PORT = 4173;
const API_PORT = 8081;
const dist = new URL('../build/', import.meta.url).pathname;

const types = {
	'.html': 'text/html',
	'.js': 'text/javascript',
	'.css': 'text/css',
	'.svg': 'image/svg+xml',
	'.woff2': 'font/woff2',
	'.json': 'application/json'
};

const go = spawn('go', ['run', '.'], {
	cwd: new URL('../../server/', import.meta.url).pathname,
	env: {
		...process.env,
		WATTROOM_ADDR: `:${API_PORT}`,
		// The login gate (ADR-0009) means even the e2e ride signs in — the dev
		// provider against a real Postgres, same doors production uses.
		WATTROOM_DB:
			process.env.WATTROOM_DB ??
			'postgres://wattroom:wattroom@localhost:5432/wattroom',
		WATTROOM_DEV_LOGIN: '1'
	},
	stdio: 'inherit'
});
process.on('exit', () => go.kill());
for (const signal of ['SIGINT', 'SIGTERM']) {
	process.on(signal, () => {
		go.kill();
		process.exit(0);
	});
}

const web = createServer((req, res) => {
	if (req.url.startsWith('/api/')) {
		const upstreamReq = httpRequest(
			{
				host: '127.0.0.1',
				port: API_PORT,
				path: req.url,
				method: req.method,
				headers: req.headers
			},
			(upstream) => {
				res.writeHead(upstream.statusCode, upstream.headers);
				upstream.pipe(res);
			}
		);
		upstreamReq.on('error', () => {
			res.writeHead(502).end('api unavailable');
		});
		req.pipe(upstreamReq);
		return;
	}

	const requested = normalize(decodeURIComponent(req.url.split('?')[0])).replace(/^(\.\.[/\\])+/, '');
	let file = join(dist, requested);
	if (!existsSync(file) || statSync(file).isDirectory()) file = join(dist, 'index.html');
	res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' });
	createReadStream(file).pipe(res);
});

// The room talks over /ws (live.svelte.ts), so the proxy has to carry the
// upgrade too — an HTTP-only proxy leaves the SPA stuck on "Lost the room" and
// every room flow untestable. Raw socket piping: the handshake is already a
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

// Playwright's readiness probe hits :4173 — only answer once the Go API is
// actually up, so the probe covers both processes and no spec ever races a
// cold `go run` compile.
async function apiReady() {
	for (let attempt = 0; attempt < 240; attempt++) {
		const ok = await new Promise((resolve) => {
			const probe = httpRequest(
				{ host: '127.0.0.1', port: API_PORT, path: '/api/healthz' },
				(res) => resolve(res.statusCode === 200)
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
web.listen(WEB_PORT, () => console.log(`e2e web on :${WEB_PORT}, api on :${API_PORT}`));
