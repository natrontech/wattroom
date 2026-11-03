import { FPS } from './loop';

/**
 * Each frame's GPU time where the browser lends a timer
 * (EXT_disjoint_timer_query_webgl2), for the quality ladder (#3295); null
 * where it does not, and the ladder judges missed intervals instead. A
 * frame's time arrives a frame or few after it was drawn.
 */
export function gpuTimer(gl: WebGL2RenderingContext) {
	const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2') as {
		TIME_ELAPSED_EXT: number;
		GPU_DISJOINT_EXT: number;
	} | null;
	if (!ext) return null;
	const pending: WebGLQuery[] = [];
	let open: WebGLQuery | null = null;
	return {
		begin() {
			// A second's frames waiting is a timer that stopped answering (a lost context): stop asking.
			if (open || pending.length >= FPS) return;
			open = gl.createQuery();
			if (open) gl.beginQuery(ext.TIME_ELAPSED_EXT, open);
		},
		end() {
			if (!open) return;
			gl.endQuery(ext.TIME_ELAPSED_EXT);
			pending.push(open);
			open = null;
		},
		/** The GPU times, ms, of the frames finished since the last call; none across a disjoint (the GPU's clock jumped). */
		read(): number[] {
			const out: number[] = [];
			const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT) as boolean;
			while (
				pending.length &&
				gl.getQueryParameter(pending[0], gl.QUERY_RESULT_AVAILABLE)
			) {
				const q = pending.shift()!;
				const ns = gl.getQueryParameter(q, gl.QUERY_RESULT) as number;
				gl.deleteQuery(q);
				if (!disjoint) out.push(ns / 1e6);
			}
			return out;
		},
	};
}

export type GpuTimer = NonNullable<ReturnType<typeof gpuTimer>>;
