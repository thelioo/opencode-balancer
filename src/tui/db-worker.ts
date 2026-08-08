import { getSelectedAccount, listAccounts } from "../core/accounts";
import { openBalancerDatabase } from "../core/database";
import { listEvents } from "../core/events";
import { storePath } from "../core/path";
import { listPendingConnections } from "../core/pending";
import {
	getBalancingEnabled,
	getQuotaAwareSelectionEnabled,
	listProviderPriority,
	resolveActiveSelection,
} from "../core/priority";
import { getUsageSnapshot } from "../core/usage/store";
import type {
	MainToWorkerMessage,
	TuiSnapshot,
	WorkerToMainMessage,
} from "./db-worker-protocol";

export function snapshotsEqual(
	a: TuiSnapshot | null,
	b: TuiSnapshot | null,
): boolean {
	if (a === b) return true;
	if (!a || !b) return false;
	return JSON.stringify(a) === JSON.stringify(b);
}

let pollInterval: ReturnType<typeof setInterval> | null = null;
let lastSnapshot: TuiSnapshot | null = null;

export function readSnapshot(): TuiSnapshot {
	const dbPath = storePath();
	const db = openBalancerDatabase(dbPath);

	const accounts = listAccounts(db);
	const pending = listPendingConnections(db);
	const events = listEvents(db, 10);
	const balancingEnabled = getBalancingEnabled(db);
	const quotaAwareSelectionEnabled = getQuotaAwareSelectionEnabled(db);

	const usageSnapshots: Record<
		string,
		import("../core/usage/types").ProviderUsageSnapshot | undefined
	> = {};
	for (const account of accounts) {
		const key = `${account.providerID}/${account.alias}`;
		usageSnapshots[key] = getUsageSnapshot(
			db,
			account.providerID,
			account.alias,
		);
	}

	const providerPriority = listProviderPriority(db);
	const selectedAccount = getSelectedAccount(db);
	const activeSelection = resolveActiveSelection(db);

	return {
		accounts,
		activeSelection,
		balancingEnabled,
		events,
		pending,
		providerPriority,
		quotaAwareSelectionEnabled,
		selectedAccount,
		usageSnapshots,
	};
}

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
