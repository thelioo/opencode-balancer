export type TuiSnapshot = {
	accounts: import("../core/types").Account[];
	pending: import("../core/types").PendingConnection[];
	events: import("../core/types").BalancerEvent[];
	balancingEnabled: boolean;
	quotaAwareSelectionEnabled: boolean;
	usageSnapshots: Record<
		string,
		import("../core/usage/types").ProviderUsageSnapshot | undefined
	>;
	providerPriority: import("../core/priority").PriorityEntry[];
	selectedAccount: import("../core/types").Account | undefined;
	activeSelection: import("../core/priority").ActiveSelection | undefined;
};

export type WorkerToMainMessage =
	| { type: "snapshot"; data: TuiSnapshot; timestamp: number }
	| { type: "error"; message: string; timestamp: number }
	| { type: "heartbeat"; timestamp: number };

export type MainToWorkerMessage =
	| { type: "start" }
	| { type: "stop" }
	| { type: "force-refresh" };
