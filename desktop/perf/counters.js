// The two clocks `make perf` reads (#3039), both cumulative since a process
// started, so a reading is always the difference of two snapshots.
const { execFileSync } = require('node:child_process');

/**
 * Nanoseconds of GPU time per pid, from the Apple GPU driver's per-client
 * accounting — the figure Activity Monitor's "% GPU" is built on. One process
 * holds several clients (one per Metal device/queue), so they are summed.
 */
function gpuNanos() {
	const text = execFileSync(
		'ioreg',
		['-r', '-c', 'AGXDeviceUserClient', '-l', '-w0'],
		{ maxBuffer: 64 * 1024 * 1024 },
	).toString();
	const byPid = new Map();
	const names = new Map();
	for (const chunk of text.split('+-o AGXDeviceUserClient').slice(1)) {
		const creator = /"IOUserClientCreator" = "pid (\d+), ([^"]*)"/.exec(chunk);
		if (!creator) continue;
		const pid = Number(creator[1]);
		let total = 0;
		for (const m of chunk.matchAll(/"accumulatedGPUTime"=(\d+)/g))
			total += Number(m[1]);
		byPid.set(pid, (byPid.get(pid) ?? 0) + total);
		names.set(pid, creator[2]);
	}
	return { byPid, names };
}

/** Seconds of CPU time per pid, from `ps` (centisecond resolution). */
function cpuSeconds(pids) {
	if (pids.length === 0) return new Map();
	let out = '';
	try {
		out = execFileSync('ps', [
			'-o',
			'pid=,time=',
			'-p',
			pids.join(','),
		]).toString();
	} catch (err) {
		// ps exits 1 when one of the pids has gone; what it printed still counts.
		out = err.stdout?.toString() ?? '';
	}
	const seconds = new Map();
	for (const line of out.trim().split('\n')) {
		const [pid, time] = line.trim().split(/\s+/);
		if (!time) continue;
		const parts = time.split(':').map(Number);
		seconds.set(
			Number(pid),
			parts.reduce((acc, part) => acc * 60 + part, 0),
		);
	}
	return seconds;
}

module.exports = { gpuNanos, cpuSeconds };
