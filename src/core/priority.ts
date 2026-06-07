import type { Database } from "bun:sqlite";
import { getActiveAccount, listAccounts } from "./accounts";
import { now } from "./time";
import type { Account } from "./types";

export type PriorityEntry = {
    providerID: string;
    position: number;
    modelID?: string;
    enabled: boolean;
};

export type ActiveSelection = {
    providerID: string;
    modelID: string;
    account: Account;
};

type PriorityRow = {
    provider_id: string;
    position: number;
    model_id: string | null;
    enabled: number;
};

function storedRows(db: Database): Map<string, PriorityRow> {
    const rows = db
        .query<PriorityRow, []>("SELECT provider_id, position, model_id, enabled FROM provider_priority")
        .all();
    return new Map(rows.map((row) => [row.provider_id, row]));
}

function providersWithAccounts(db: Database): string[] {
    return [...new Set(listAccounts(db).map((account) => account.providerID))];
}

function nextPosition(stored: Map<string, PriorityRow>): number {
    let max = -1;
    for (const row of stored.values()) max = Math.max(max, row.position);
    return max + 1;
}

function upsert(
    db: Database,
    providerID: string,
    patch: { position?: number; modelID?: string | null; enabled?: boolean },
) {
    const stored = storedRows(db);
    const existing = stored.get(providerID);
    const position = patch.position ?? existing?.position ?? nextPosition(stored);
    const modelID = patch.modelID !== undefined ? patch.modelID : (existing?.model_id ?? null);
    const enabled = patch.enabled !== undefined ? (patch.enabled ? 1 : 0) : (existing?.enabled ?? 1);

    db.query<unknown, [string, number, string | null, number, number]>(
        `INSERT INTO provider_priority (provider_id, position, model_id, enabled, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(provider_id) DO UPDATE SET
             position = excluded.position,
             model_id = excluded.model_id,
             enabled = excluded.enabled,
             updated_at = excluded.updated_at`,
    ).run(providerID, position, modelID, enabled, now());
}

export function listProviderPriority(db: Database): PriorityEntry[] {
    const stored = storedRows(db);
    const providers = providersWithAccounts(db);

    const ordered = providers.slice().sort((a, b) => {
        const ra = stored.get(a);
        const rb = stored.get(b);
        if (ra && rb) return ra.position - rb.position || a.localeCompare(b);
        if (ra) return -1;
        if (rb) return 1;
        return a.localeCompare(b);
    });

    return ordered.map((providerID, index) => {
        const row = stored.get(providerID);
        return {
            providerID,
            position: index,
            modelID: row?.model_id ?? undefined,
            enabled: row ? row.enabled === 1 : true,
        };
    });
}

export function setProviderModel(db: Database, providerID: string, modelID: string) {
    upsert(db, providerID, { modelID });
}

export function setProviderEnabled(db: Database, providerID: string, enabled: boolean) {
    upsert(db, providerID, { enabled });
}

export function moveProvider(db: Database, providerID: string, direction: -1 | 1) {
    const list = listProviderPriority(db);
    const index = list.findIndex((entry) => entry.providerID === providerID);
    if (index === -1) return;
    const target = index + direction;
    if (target < 0 || target >= list.length) return;

    const reordered = list.slice();
    const [moved] = reordered.splice(index, 1);
    reordered.splice(target, 0, moved);

    const persist = db.transaction(() => {
        reordered.forEach((entry, position) => upsert(db, entry.providerID, { position }));
    });
    persist();
}

export function getBalancingEnabled(db: Database): boolean {
    const row = db
        .query<{ value: string }, [string]>("SELECT value FROM settings WHERE key = ?")
        .get("balancing_enabled");
    return row?.value === "1";
}

export function setBalancingEnabled(db: Database, enabled: boolean) {
    db.query<unknown, [string]>(
        `INSERT INTO settings (key, value) VALUES ('balancing_enabled', ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    ).run(enabled ? "1" : "0");
}

function chooseHealthyAccount(db: Database, providerID: string, nowMs: number): Account | undefined {
    const healthy = listAccounts(db, providerID).filter(
        (account) => !account.disabled && (!account.rateLimitedUntil || account.rateLimitedUntil <= nowMs),
    );
    if (healthy.length === 0) return undefined;

    const active = getActiveAccount(db, providerID);
    if (active && healthy.some((account) => account.alias === active.alias)) return active;
    return healthy[0];
}

export function resolveActiveSelection(db: Database, nowMs: number = now(), preferredProviderID?: string): ActiveSelection | undefined {
    const entries = listProviderPriority(db);
    const ordered = preferredProviderID
        ? entries.slice().sort((a, b) => {
              if (a.providerID === preferredProviderID) return -1;
              if (b.providerID === preferredProviderID) return 1;
              return a.position - b.position;
          })
        : entries;

    for (const entry of ordered) {
        if (!entry.enabled) continue;
        if (!entry.modelID) continue;
        const account = chooseHealthyAccount(db, entry.providerID, nowMs);
        if (!account) continue;
        return { providerID: entry.providerID, modelID: entry.modelID, account };
    }
    return undefined;
}
