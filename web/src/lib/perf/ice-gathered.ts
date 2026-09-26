/**
 * Resolves once a peer connection has gathered every candidate, so its local
 * description can travel whole — the perf harness relays one offer and one
 * answer between two windows and carries no trickle (#3039).
 */
export function iceGathered(conn: RTCPeerConnection): Promise<void> {
	return new Promise((resolve) => {
		if (conn.iceGatheringState === 'complete') resolve();
		conn.onicegatheringstatechange = () =>
			conn.iceGatheringState === 'complete' && resolve();
	});
}
