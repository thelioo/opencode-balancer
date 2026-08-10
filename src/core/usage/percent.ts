import type { ProviderUsageSnapshot } from "./types";

// Returns the account's used-quota percentage (0-100), or undefined when we
// have no reliable usage data for it (never fetched, provider doesn't
// support usage reporting, or the last fetch failed/was unavailable).
export function snapshotUsedPercent(
	snapshot: ProviderUsageSnapshot | undefined,
) {
	if (!snapshot || snapshot.confidence === "unavailable") return undefined;
	if (snapshot.usedPercent !== undefined) return snapshot.usedPercent;
	if (
		snapshot.usedTokens !== undefined &&
		snapshot.remainingTokens !== undefined
	) {
		const total = snapshot.usedTokens + snapshot.remainingTokens;
		if (total > 0) return (snapshot.usedTokens / total) * 100;
	}
	return undefined;
}
