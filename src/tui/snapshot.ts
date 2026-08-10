import {
	getActiveAccount,
	getSelectedAccount,
	listAccounts,
} from "../core/accounts";
import { openBalancerDatabase } from "../core/database";
import { listEvents } from "../core/events";
import { storePath } from "../core/path";
import { listPendingConnections } from "../core/pending";
import {
	type ActiveSelection,
	getBalancingEnabled,
	getQuotaAwareSelectionEnabled,
	listProviderPriority,
	resolveActiveSelection,
} from "../core/priority";
import type { Account } from "../core/types";
import { getUsageSnapshot } from "../core/usage/store";
import type { TuiSnapshot } from "./db-worker-protocol";

export function snapshotsEqual(
	a: TuiSnapshot | null,
	b: TuiSnapshot | null,
): boolean {
	if (a === b) return true;
	if (!a || !b) return false;
	return JSON.stringify(a) === JSON.stringify(b);
}

// Pure, synchronous read of everything the TUI needs to render. Safe to call
// from the db-worker's polling loop (off the main thread) *or* directly on
// the main thread as a one-off after a write (see state.ts's refresh()) —
// the latter is fine because it's triggered by a discrete user action, not
// a timer, so it can't reintroduce the keystroke-blocking polling mechanism
// this file exists to get off the main thread.
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

	// Any providerID a live session could report (e.g. via inferProviderID)
	// only has a meaningful "active account" if it has at least one saved
	// account, so it's enough to compute this for the providers we already
	// know about from `accounts`.
	const activeAccountByProvider: Record<string, Account> = {};
	for (const providerID of new Set(accounts.map((a) => a.providerID))) {
		const active = getActiveAccount(db, providerID);
		if (active) activeAccountByProvider[providerID] = active;
	}

	// For each provider with a priority entry, check whether that entry
	// alone would qualify as the active selection (enabled, has a model, has
	// a healthy account). See the qualifyingSelectionByProvider doc comment
	// in db-worker-protocol.ts for why this is sufficient to reconstruct
	// resolveActiveSelection(db, now, providerID) for any providerID without
	// re-running the resolver on the main thread.
	const qualifyingSelectionByProvider: Record<string, ActiveSelection> = {};
	for (const entry of providerPriority) {
		const resolved = resolveActiveSelection(db, undefined, entry.providerID);
		if (resolved && resolved.providerID === entry.providerID) {
			qualifyingSelectionByProvider[entry.providerID] = resolved;
		}
	}

	return {
		accounts,
		activeAccountByProvider,
		activeSelection,
		balancingEnabled,
		events,
		pending,
		providerPriority,
		qualifyingSelectionByProvider,
		quotaAwareSelectionEnabled,
		selectedAccount,
		usageSnapshots,
	};
}
