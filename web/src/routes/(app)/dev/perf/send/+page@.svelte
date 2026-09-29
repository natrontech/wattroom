<script lang="ts">
	import { page } from '$app/state';
	import { iceGathered } from '$lib/perf/ice-gathered';

	/**
	 * The far end of /dev/perf's screen share and camera cases (#3039). The
	 * harness opens this in a hidden window — its own renderer — so encoding
	 * never lands in the viewer's numbers. The canvas is CPU-backed
	 * (`willReadFrequently`) for the same reason: drawing it must not show up
	 * as GPU time in the process being measured.
	 *
	 * The screen is a code editor's worth of changing text, `contentHint`
	 * 'detail' like a real screen capture, at LiveKit's screen share ceiling
	 * (h1080fps15) unless `fps` says otherwise. The camera is 720p30 motion.
	 */
	const params = page.url.searchParams;
	const camera = params.get('case') === 'camera';
	const count = camera ? Number(params.get('n') ?? 1) : 1;
	const fps = camera ? 30 : Number(params.get('fps') ?? 15);
	const [width, height] = camera ? [1280, 720] : [1920, 1080];
	const maxBitrate = camera ? 1_700_000 : 2_500_000;

	const pc = new RTCPeerConnection();

	function drawScreen(g: CanvasRenderingContext2D, frame: number) {
		g.fillStyle = '#1e1e1e';
		g.fillRect(0, 0, width, height);
		g.font = '18px monospace';
		const colours = ['#9cdcfe', '#ce9178', '#569cd6', '#6a9955'];
		for (let line = 0; line < height / 22; line++) {
			g.fillStyle = colours[(line + frame) % colours.length];
			g.fillText(
				`${(line + frame) % 400}  const value${line} = compute(${frame}, "line ${line}");`,
				40,
				30 + line * 21,
			);
		}
	}

	function drawCamera(g: CanvasRenderingContext2D, frame: number) {
		const t = frame / 30;
		g.fillStyle = `hsl(${(t * 20) % 360} 40% 30%)`;
		g.fillRect(0, 0, width, height);
		g.fillStyle = '#e0b090';
		g.beginPath();
		g.arc(
			width / 2 + Math.sin(t) * 40,
			height / 2 + Math.cos(t * 1.3) * 20,
			height / 4,
			0,
			Math.PI * 2,
		);
		g.fill();
	}

	for (let i = 0; i < count; i++) {
		const canvas = document.createElement('canvas');
		canvas.width = width;
		canvas.height = height;
		const g = canvas.getContext('2d', { willReadFrequently: true })!;
		let frame = 0;
		setInterval(
			() => (camera ? drawCamera : drawScreen)(g, frame++),
			1000 / fps,
		);
		const stream = canvas.captureStream(fps);
		const [track] = stream.getVideoTracks();
		track.contentHint = camera ? 'motion' : 'detail';
		pc.addTrack(track, stream);
	}

	Object.assign(window, {
		perfMakeOffer: async () => {
			await pc.setLocalDescription();
			await iceGathered(pc);
			return pc.localDescription?.toJSON();
		},
		perfAcceptAnswer: async (answer: RTCSessionDescriptionInit) => {
			await pc.setRemoteDescription(answer);
			for (const sender of pc.getSenders()) {
				const p = sender.getParameters();
				p.encodings[0] = { ...p.encodings[0], maxBitrate, maxFramerate: fps };
				await sender.setParameters(p);
			}
			return true;
		},
	});
	document.title = 'perf:sender';
</script>
