import type { Database } from "bun:sqlite";
import type { ProviderUsageSnapshot } from "./types";

export function saveUsageSnapshot(
	db: Database,
	snapshot: ProviderUsageSnapshot,
) {
	const { rawRedacted, ...normalizedSnapshot } = snapshot;
	const rawRedactedJSON = Object.hasOwn(snapshot, "rawRedacted")
		? JSON.stringify(rawRedacted)
		: null;

	db.query(
		`INSERT INTO usage_snapshots (
            provider_id, alias, fetched_at, confidence, normalized_json, raw_redacted_json, error
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(provider_id, alias) DO UPDATE SET
            fetched_at = excluded.fetched_at,
            confidence = excluded.confidence,
            normalized_json = excluded.normalized_json,
            raw_redacted_json = excluded.raw_redacted_json,
            error = excluded.error`,
	).run(
		snapshot.providerID,
		snapshot.alias,
		snapshot.fetchedAt,
		snapshot.confidence,
		JSON.stringify(normalizedSnapshot),
		rawRedactedJSON,
		snapshot.error ?? null,
	);

	if (
		snapshot.confidence === "exact" &&
		snapshot.usedPercent !== undefined &&
		snapshot.usedPercent < 100
	) {
		db.query<unknown, [number, string, string]>(
			`UPDATE accounts
             SET rate_limited_until = NULL,
                 updated_at = ?
             WHERE provider_id = ? AND alias = ?`,
		).run(snapshot.fetchedAt, snapshot.providerID, snapshot.alias);
	}
}

export function getUsageSnapshot(
	db: Database,
	providerID: string,
	alias: string,
) {
	const row = db
		.query<
			{ normalized_json: string; raw_redacted_json: string | null },
			[string, string]
		>(
			"SELECT normalized_json, raw_redacted_json FROM usage_snapshots WHERE provider_id = ? AND alias = ?",
		)
		.get(providerID, alias);
	if (!row) return undefined;

	const snapshot = JSON.parse(row.normalized_json) as ProviderUsageSnapshot;
	if (row.raw_redacted_json !== null)
		snapshot.rawRedacted = JSON.parse(row.raw_redacted_json);
	return snapshot;
}
