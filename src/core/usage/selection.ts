import type { Database } from "bun:sqlite";
import { snapshotUsedPercent } from "./percent";
import { getUsageSnapshot } from "./store";

// Returns the account's remaining quota headroom as a percentage (0-100), or
// undefined when we don't have reliable usage data for it (never fetched,
// provider doesn't support usage reporting, or confidence is "unavailable").
export function accountRemainingPercent(
	db: Database,
	providerID: string,
	alias: string,
) {
	const used = snapshotUsedPercent(getUsageSnapshot(db, providerID, alias));
	return used === undefined ? undefined : 100 - used;
}

// Ranks accounts by remaining quota headroom, most headroom first. Accounts
// with unknown usage sort after every account with known usage (we can't
// confirm an unknown account is actually better than a known one), then fall
// back to alphabetical-by-alias among themselves for determinism.
export function rankByRemainingQuota<T extends { alias: string }>(
	db: Database,
	providerID: string,
	accounts: T[],
): Array<{ account: T; remainingPercent: number | undefined }> {
	return accounts
		.map((account) => ({
			account,
			remainingPercent: accountRemainingPercent(db, providerID, account.alias),
		}))
		.sort((a, b) => {
			if (a.remainingPercent === undefined && b.remainingPercent === undefined)
				return a.account.alias.localeCompare(b.account.alias);
			if (a.remainingPercent === undefined) return 1;
			if (b.remainingPercent === undefined) return -1;
			return b.remainingPercent - a.remainingPercent;
		});
}
