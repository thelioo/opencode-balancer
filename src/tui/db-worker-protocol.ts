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
	// Keyed by providerID. Mirrors core/accounts.ts:getActiveAccount for every
	// provider that has at least one saved account, so components that need
	// the active account for an arbitrary (session-supplied) providerID don't
	// have to query bun:sqlite directly.
	activeAccountByProvider: Record<string, import("../core/types").Account>;
	// Keyed by providerID. Present only for providers whose own priority
	// entry "qualifies" on its own (enabled, has a model, has a healthy
	// account) — i.e. resolveActiveSelection(db, now, providerID) returned a
	// selection for that exact providerID. When a providerID isn't a key
	// here, callers should fall back to `activeSelection` (equivalent to
	// resolveActiveSelection(db, now, providerID) when that provider's own
	// entry doesn't qualify, since the two calls only differ in which entry
	// is *tried first*, not in the overall fallback order).
	qualifyingSelectionByProvider: Record<
		string,
		import("../core/priority").ActiveSelection
	>;
};

export type WorkerToMainMessage =
	| { type: "snapshot"; data: TuiSnapshot; timestamp: number }
	| { type: "error"; message: string; timestamp: number }
	| { type: "heartbeat"; timestamp: number };

export type MainToWorkerMessage =
	| { type: "start" }
	| { type: "stop" }
	| { type: "force-refresh" };
