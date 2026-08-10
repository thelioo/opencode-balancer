import type {
	MainToWorkerMessage,
	TuiSnapshot,
	WorkerToMainMessage,
} from "./db-worker-protocol";

type Listener = (snapshot: TuiSnapshot | null, isStale: boolean) => void;

let worker: Worker | null = null;
let currentSnapshot: TuiSnapshot | null = null;
let lastHeartbeatAt: number | null = null;
let isStale = false;
const listeners = new Set<Listener>();
let stalenessTimer: ReturnType<typeof setInterval> | null = null;

function notifyListeners() {
	for (const fn of listeners) {
		try {
			fn(currentSnapshot, isStale);
		} catch {
			// ignore subscriber errors
		}
	}
}

function checkStaleness() {
	if (lastHeartbeatAt === null) return;
	const now = Date.now();
	const newlyStale = now - lastHeartbeatAt > 3000;
	if (newlyStale !== isStale) {
		isStale = newlyStale;
		notifyListeners();
	}
}

export function handleWorkerMessage(msg: WorkerToMainMessage) {
	if (msg.type === "snapshot") {
		currentSnapshot = msg.data;
		lastHeartbeatAt = msg.timestamp;
		isStale = false;
		notifyListeners();
	} else if (msg.type === "heartbeat") {
		lastHeartbeatAt = msg.timestamp;
		if (isStale) {
			isStale = false;
			notifyListeners();
		}
	} else if (msg.type === "error") {
		// logged or swallowed
	}
}

export function initTuiCache() {
	if (worker) return;

	try {
		const workerUrl = new URL("./db-worker.ts", import.meta.url);
		worker = new Worker(workerUrl, { type: "module" });
	} catch {
		try {
			worker = new Worker(new URL("./db-worker.js", import.meta.url), {
				type: "module",
			});
		} catch {
			// fallback
		}
	}

	if (worker) {
		worker.onmessage = (event: MessageEvent<WorkerToMainMessage>) => {
			handleWorkerMessage(event.data);
		};
		worker.onerror = () => {
			isStale = true;
			notifyListeners();
		};
		worker.postMessage({ type: "start" } satisfies MainToWorkerMessage);
	}

	if (!stalenessTimer) {
		stalenessTimer = setInterval(checkStaleness, 1000);
	}
}

export function subscribeTuiCache(listener: Listener): () => void {
	initTuiCache();
	listeners.add(listener);
	listener(currentSnapshot, isStale);
	return () => {
		listeners.delete(listener);
	};
}

export function getTuiSnapshot(): TuiSnapshot | null {
	return currentSnapshot;
}

export function isTuiSnapshotStale(): boolean {
	return isStale;
}

export function forceTuiRefresh(): void {
	if (worker) {
		worker.postMessage({ type: "force-refresh" } satisfies MainToWorkerMessage);
	}
}

export function shutdownTuiCache(): void {
	if (stalenessTimer) {
		clearInterval(stalenessTimer);
		stalenessTimer = null;
	}
	if (worker) {
		worker.postMessage({ type: "stop" } satisfies MainToWorkerMessage);
		worker.terminate();
		worker = null;
	}
	currentSnapshot = null;
	lastHeartbeatAt = null;
	isStale = false;
	listeners.clear();
}
