import type {
	MainToWorkerMessage,
	TuiSnapshot,
	WorkerToMainMessage,
} from "./db-worker-protocol";
import { readSnapshot, snapshotsEqual } from "./snapshot";

// Re-exported for backwards compatibility (test/tui/db-worker.test.ts and
// anything else importing these from here) — the actual implementation now
// lives in ./snapshot so it can be shared with the main thread's one-off
// refresh path without pulling this file's self.onmessage registration into
// the main-thread bundle.
export { readSnapshot, snapshotsEqual };

let pollInterval: ReturnType<typeof setInterval> | null = null;
let lastSnapshot: TuiSnapshot | null = null;

function postToMain(msg: WorkerToMainMessage) {
	if (typeof self !== "undefined" && typeof self.postMessage === "function") {
		self.postMessage(msg);
	}
}

export function performPollCycle() {
	try {
		const snapshot = readSnapshot();
		if (!snapshotsEqual(snapshot, lastSnapshot)) {
			lastSnapshot = snapshot;
			postToMain({ data: snapshot, timestamp: Date.now(), type: "snapshot" });
		}
		postToMain({ timestamp: Date.now(), type: "heartbeat" });
	} catch (err) {
		postToMain({
			message: err instanceof Error ? err.message : String(err),
			timestamp: Date.now(),
			type: "error",
		});
	}
}

function startPolling() {
	if (pollInterval) return;
	performPollCycle();
	pollInterval = setInterval(performPollCycle, 1000);
}

function stopPolling() {
	if (pollInterval) {
		clearInterval(pollInterval);
		pollInterval = null;
	}
}

if (typeof self !== "undefined") {
	self.onmessage = (event: MessageEvent<MainToWorkerMessage>) => {
		const msg = event.data;
		if (msg.type === "start") {
			startPolling();
		} else if (msg.type === "stop") {
			stopPolling();
		} else if (msg.type === "force-refresh") {
			performPollCycle();
		}
	};
}
