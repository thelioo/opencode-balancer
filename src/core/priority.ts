import type { Database } from "bun:sqlite";
import { getActiveAccount, listAccounts } from "./accounts";
import { now } from "./time";
import type { Account } from "./types";
import { rankByRemainingQuota } from "./usage/selection";

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
		.query<PriorityRow, []>(
			"SELECT provider_id, position, model_id, enabled FROM provider_priority",
		)
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
	const modelID =
		patch.modelID !== undefined ? patch.modelID : (existing?.model_id ?? null);
	const enabled =
		patch.enabled !== undefined
			? patch.enabled
				? 1
				: 0
			: (existing?.enabled ?? 1);

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
			enabled: row ? row.enabled === 1 : true,
			modelID: row?.model_id ?? undefined,
			position: index,
			providerID,
		};
	});
}

export function setProviderModel(
	db: Database,
	providerID: string,
	modelID: string,
) {
	upsert(db, providerID, { modelID });
}

export function setProviderEnabled(
	db: Database,
	providerID: string,
	enabled: boolean,
) {
	upsert(db, providerID, { enabled });
}

export function moveProvider(
	db: Database,
	providerID: string,
	direction: -1 | 1,
) {
	const list = listProviderPriority(db);
	const index = list.findIndex((entry) => entry.providerID === providerID);
	if (index === -1) return;
	const target = index + direction;
	if (target < 0 || target >= list.length) return;

	const reordered = list.slice();
	const [moved] = reordered.splice(index, 1);
	reordered.splice(target, 0, moved);

	const persist = db.transaction(() => {
		for (const [position, entry] of reordered.entries()) {
			upsert(db, entry.providerID, { position });
		}
	});
	persist();
}

export function getBalancingEnabled(db: Database): boolean {
	const row = db
		.query<{ value: string }, [string]>(
			"SELECT value FROM settings WHERE key = ?",
		)
		.get("balancing_enabled");

	return row?.value === "1";
}

export function setBalancingEnabled(db: Database, enabled: boolean) {
	db.query<unknown, [string]>(
		`INSERT INTO settings (key, value) VALUES ('balancing_enabled', ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
	).run(enabled ? "1" : "0");
}

// Defaults to on: among healthy accounts, prefer the one with the most
// remaining quota headroom instead of picking arbitrarily (alphabetically).
// Falls back to the old alphabetical/sticky-only behavior for any provider
// where we don't have usage data, or when explicitly turned off.
export function getQuotaAwareSelectionEnabled(db: Database): boolean {
	const row = db
		.query<{ value: string }, [string]>(
			"SELECT value FROM settings WHERE key = ?",
		)
		.get("quota_aware_selection_enabled");

	return row?.value !== "0";
}

export function setQuotaAwareSelectionEnabled(db: Database, enabled: boolean) {
	db.query<unknown, [string]>(
		`INSERT INTO settings (key, value) VALUES ('quota_aware_selection_enabled', ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
	).run(enabled ? "1" : "0");
}

// Only move off the currently active (sticky) account if another healthy
// account has at least this many more percentage points of quota headroom.
// Without this, two accounts with near-identical usage could flip-flop on
// every selection as their usage snapshots refresh at slightly different
// times, causing needless account switches (extra auth writes, TUI toasts).
const STICKY_SWITCH_THRESHOLD_PERCENT = 15;

function chooseHealthyAccount(
	db: Database,
	providerID: string,
	nowMs: number,
): Account | undefined {
	const healthy = listAccounts(db, providerID).filter(
		(account) =>
			!account.disabled &&
			(!account.rateLimitedUntil || account.rateLimitedUntil <= nowMs),
	);
	if (healthy.length === 0) return undefined;

	const active = getActiveAccount(db, providerID);
	const activeHealthy = active
		? healthy.find((account) => account.alias === active.alias)
		: undefined;

	if (!getQuotaAwareSelectionEnabled(db)) return activeHealthy ?? healthy[0];

	const ranked = rankByRemainingQuota(db, providerID, healthy);
	const best = ranked[0];

	if (activeHealthy) {
		const activeRanked = ranked.find(
			(entry) => entry.account.alias === activeHealthy.alias,
		);
		const activeRemaining = activeRanked?.remainingPercent;
		const bestRemaining = best.remainingPercent;
		// Stay put unless we know for certain another account has
		// meaningfully more headroom than the one we're already using.
		const bestIsMeaningfullyBetter =
			activeRemaining !== undefined &&
			bestRemaining !== undefined &&
			bestRemaining - activeRemaining >= STICKY_SWITCH_THRESHOLD_PERCENT;
		if (!bestIsMeaningfullyBetter) return activeHealthy;
	}

	return best.account;
}

export function resolveActiveSelection(
	db: Database,
	nowMs: number = now(),
	preferredProviderID?: string,
): ActiveSelection | undefined {
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
		return { account, modelID: entry.modelID, providerID: entry.providerID };
	}
	return undefined;
}
