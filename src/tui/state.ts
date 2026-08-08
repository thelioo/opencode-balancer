import type { Database } from "bun:sqlite";
import { createSignal, onCleanup } from "solid-js";
import { listAccounts } from "../core/accounts";
import { closeBalancerDatabase, openBalancerDatabase } from "../core/database";
import { listEvents } from "../core/events";
import { storePath } from "../core/path";
import { listPendingConnections } from "../core/pending";
import { migrate } from "../core/schema";
import type { Account, BalancerEvent, PendingConnection } from "../core/types";
import {
	forceTuiRefresh,
	shutdownTuiCache,
	subscribeTuiCache,
} from "./db-cache";

export type BalancerTuiState = {
	db: Database;
	version: () => number;
	refresh: () => void;
	accounts: () => Account[];
	pending: () => PendingConnection[];
	events: () => BalancerEvent[];
	removeAccountView: (providerID: string, alias: string) => void;
	removePendingView: (pendingID: string) => void;
	dispose: () => void;
};

export function createBalancerTuiState(): BalancerTuiState {
	const dbPath = storePath();
	const db = openBalancerDatabase(dbPath);
	migrate(db);

	const [version, setVersion] = createSignal(1);
	const [accounts, setAccounts] = createSignal<Account[]>(listAccounts(db));
	const [pending, setPending] = createSignal<PendingConnection[]>(
		listPendingConnections(db),
	);
	const [events, setEvents] = createSignal<BalancerEvent[]>(listEvents(db, 10));

	const unsubCache = subscribeTuiCache((snapshot) => {
		if (!snapshot) return;
		setAccounts(snapshot.accounts);
		setPending(snapshot.pending);
		setEvents(snapshot.events);
		setVersion((v) => v + 1);
	});

	const refresh = () => {
		setAccounts(listAccounts(db));
		setPending(listPendingConnections(db));
		setEvents(listEvents(db, 10));
		setVersion((current) => current + 1);
		forceTuiRefresh();
	};

	const removeAccountView = (providerID: string, alias: string) => {
		setAccounts((current) =>
			current.filter(
				(account) =>
					account.providerID !== providerID || account.alias !== alias,
			),
		);
		setVersion((current) => current + 1);
		forceTuiRefresh();
	};

	const removePendingView = (pendingID: string) => {
		setPending((current) =>
			current.filter((pending) => pending.id !== pendingID),
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
		version,
	};
}
