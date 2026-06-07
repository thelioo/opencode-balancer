import type { Database } from "bun:sqlite";
import { createSignal, onCleanup } from "solid-js";
import { listAccounts } from "../core/accounts";
import { closeBalancerDatabase, openBalancerDatabase } from "../core/database";
import { listEvents } from "../core/events";
import { listPendingConnections } from "../core/pending";
import { storePath } from "../core/path";
import { migrate } from "../core/schema";
import type { Account, BalancerEvent, PendingConnection } from "../core/types";

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

    const [version, setVersion] = createSignal(0);
    const [accounts, setAccounts] = createSignal<Account[]>([]);
    const [pending, setPending] = createSignal<PendingConnection[]>([]);
    const [events, setEvents] = createSignal<BalancerEvent[]>([]);

    const refresh = () => {
        setAccounts(listAccounts(db));
        setPending(listPendingConnections(db));
        setEvents(listEvents(db, 10));
        setVersion((current) => current + 1);
    };
    const removeAccountView = (providerID: string, alias: string) => {
        setAccounts((current) => current.filter((account) => account.providerID !== providerID || account.alias !== alias));
        setVersion((current) => current + 1);
    };
    const removePendingView = (pendingID: string) => {
        setPending((current) => current.filter((pending) => pending.id !== pendingID));
        setVersion((current) => current + 1);
    };

    let interval: ReturnType<typeof setInterval> | undefined;
    let disposed = false;

    const dispose = () => {
        if (disposed) return;
        disposed = true;
        if (interval) clearInterval(interval);
        interval = undefined;
        closeBalancerDatabase(dbPath);
    };

    refresh();

    interval = setInterval(refresh, 1000);
    onCleanup(dispose);

    return { db, version, refresh, accounts, pending, events, removeAccountView, removePendingView, dispose };
}
