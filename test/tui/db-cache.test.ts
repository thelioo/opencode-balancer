import { describe, expect, test } from "bun:test";
import {
	getTuiSnapshot,
	handleWorkerMessage,
	isTuiSnapshotStale,
	shutdownTuiCache,
	subscribeTuiCache,
} from "../../src/tui/db-cache";
import type { TuiSnapshot } from "../../src/tui/db-worker-protocol";

describe("db-cache business logic", () => {
	test("subscribers receive live snapshot updates from worker messages", () => {
		shutdownTuiCache();

		const sampleSnapshot: TuiSnapshot = {
			accounts: [
				{
					alias: "main",
					auth: { key: "sk-test", type: "api" },
					authType: "api",
					createdAt: 1000,
					disabled: false,
					failures: 0,
					providerID: "anthropic",
					updatedAt: 1000,
				},
			],
			activeAccountByProvider: {},
			activeSelection: undefined,
			balancingEnabled: true,
			events: [],
			pending: [],
			providerPriority: [],
			qualifyingSelectionByProvider: {},
			quotaAwareSelectionEnabled: true,
			selectedAccount: undefined,
			usageSnapshots: {},
		};

		let receivedSnapshot = null as TuiSnapshot | null;
		let callCount = 0;

		const unsub = subscribeTuiCache((snapshot) => {
			receivedSnapshot = snapshot;
			callCount++;
		});

		// Initial callback call upon subscription
		expect(callCount).toBe(1);
		expect(receivedSnapshot).toBeNull();

		// Simulate message from worker
		handleWorkerMessage({
			data: sampleSnapshot,
			timestamp: Date.now(),
			type: "snapshot",
		});

		expect(callCount).toBe(2);
		expect(getTuiSnapshot()).toEqual(sampleSnapshot);
		expect(receivedSnapshot).toEqual(sampleSnapshot);
		expect(isTuiSnapshotStale()).toBe(false);

		unsub();
		shutdownTuiCache();
	});

	test("marks cache as non-stale when receiving heartbeats", () => {
		shutdownTuiCache();

		handleWorkerMessage({
			timestamp: Date.now(),
			type: "heartbeat",
		});

		expect(isTuiSnapshotStale()).toBe(false);
		shutdownTuiCache();
	});
});
