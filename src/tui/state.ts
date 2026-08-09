import type { Database } from "bun:sqlite";
import { createSignal, onCleanup } from "solid-js";
import { closeBalancerDatabase, openBalancerDatabase } from "../core/database";
import { storePath } from "../core/path";
import { migrate } from "../core/schema";
import type { Account, BalancerEvent, PendingConnection } from "../core/types";
import {
	forceTuiRefresh,
	shutdownTuiCache,
	subscribeTuiCache,
} from "./db-cache";
import type { TuiSnapshot } from "./db-worker-protocol";
import { readSnapshot } from "./snapshot";

export type BalancerTuiState = {
	db: Database;
	version: () => number;
	refresh: () => void;
	accounts: () => Account[];
	pending: () => PendingConnection[];
	events: () => BalancerEvent[];
	// Cache-backed snapshot of everything else the TUI reads on a poll
	// cadence (balancing/quota-aware flags, usage, priority order, active
	// selections). Updated by the db-worker thread; reading this never
	// touches bun:sqlite on the main thread. null until the worker's first
	// snapshot arrives.
	snapshot: () => TuiSnapshot | null;
	snapshotStale: () => boolean;
	removeAccountView: (providerID: string, alias: string) => void;
	removePendingView: (pendingID: string) => void;
	dispose: () => void;
};

export function createBalancerTuiState(): BalancerTuiState {
	const dbPath = storePath();
	const db = openBalancerDatabase(dbPath);
	migrate(db);

	// One synchronous read at mount so the first render already has real
	// data instead of waiting on the worker's first async postMessage.
	const initialSnapshot = readSnapshot();

	const [version, setVersion] = createSignal(1);
	const [accounts, setAccounts] = createSignal<Account[]>(
		initialSnapshot.accounts,
	);
	const [pending, setPending] = createSignal<PendingConnection[]>(
		initialSnapshot.pending,
	);
	const [events, setEvents] = createSignal<BalancerEvent[]>(
		initialSnapshot.events,
	);
	const [snapshot, setSnapshot] = createSignal<TuiSnapshot | null>(
		initialSnapshot,
	);
	const [snapshotStale, setSnapshotStale] = createSignal(false);

	const unsubCache = subscribeTuiCache((nextSnapshot, isStale) => {
		setSnapshotStale(isStale);
		if (!nextSnapshot) return;
		setSnapshot(nextSnapshot);
		setAccounts(nextSnapshot.accounts);
		setPending(nextSnapshot.pending);
		setEvents(nextSnapshot.events);
		setVersion((v) => v + 1);
	});

	// Triggered by discrete user actions (toggling a setting, removing an
	// account, etc.), never by a timer — so a synchronous readSnapshot()
	// call here doesn't reintroduce the keystroke-blocking polling mechanism
	// this refactor removes elsewhere. It also gives every component an
	// immediately-consistent view of balancing/quota-aware/usage/priority
	// state right after a write, without waiting on the worker's async
	// round trip.
	const refresh = () => {
		const next = readSnapshot();
		setSnapshot(next);
		setAccounts(next.accounts);
		setPending(next.pending);
		setEvents(next.events);
		setVersion((current) => current + 1);
		forceTuiRefresh();
	};

	const removeAccountView = (providerID: string, alias: string) => {
		const stillPresent = (account: Account) =>
			account.providerID !== providerID || account.alias !== alias;
		setAccounts((current) => current.filter(stillPresent));
		setSnapshot((current) =>
			current
				? { ...current, accounts: current.accounts.filter(stillPresent) }
				: current,
		);
		setVersion((current) => current + 1);
		forceTuiRefresh();
	};

	const removePendingView = (pendingID: string) => {
		const stillPresent = (item: PendingConnection) => item.id !== pendingID;
		setPending((current) => current.filter(stillPresent));
		setSnapshot((current) =>
			current
				? { ...current, pending: current.pending.filter(stillPresent) }
				: current,
		);
		setVersion((current) => current + 1);
		forceTuiRefresh();
	};

	let disposed = false;

	const dispose = () => {
		if (disposed) return;
		disposed = true;
		unsubCache();
		shutdownTuiCache();
		closeBalancerDatabase(dbPath);
	};

	onCleanup(dispose);

	return {
		accounts,
		db,
		dispose,
		events,
		pending,
		refresh,
		removeAccountView,
		removePendingView,
		snapshot,
		snapshotStale,
		version,
	};
}
