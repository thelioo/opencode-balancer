import type { Database } from "bun:sqlite";
import { now } from "./time";

function key(providerID: string) {
	return `native_auth_suppressed_until:${providerID}`;
}

export function suppressNativeAuthCapture(
	db: Database,
	providerID: string,
	durationMs = 10_000,
) {
	db.query<unknown, [string, string]>(
		`INSERT INTO settings (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
	).run(key(providerID), String(now() + durationMs));
}

export function isNativeAuthCaptureSuppressed(
	db: Database,
	providerID: string,
) {
	const settingKey = key(providerID);
	const row = db
		.query<{ value: string }, [string]>(
			"SELECT value FROM settings WHERE key = ?",
		)
		.get(settingKey);
	const suppressedUntil = Number(row?.value ?? 0);
	if (Number.isFinite(suppressedUntil) && suppressedUntil > now()) return true;
	if (row)
		db.query<unknown, [string]>("DELETE FROM settings WHERE key = ?").run(
			settingKey,
		);
	return false;
}
