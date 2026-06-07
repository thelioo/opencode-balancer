import type { Database } from "bun:sqlite";
import { now } from "./time";

const key = "native_connect_until";

export function markNativeConnectInProgress(
	db: Database,
	durationMs = 180_000,
) {
	db.query<unknown, [string]>(
		`INSERT INTO settings (key, value) VALUES ('native_connect_until', ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
	).run(String(now() + durationMs));
}

export function isNativeConnectInProgress(db: Database) {
	const row = db
		.query<{ value: string }, [string]>(
			"SELECT value FROM settings WHERE key = ?",
		)
		.get(key);
	const until = Number(row?.value ?? 0);
	if (Number.isFinite(until) && until > now()) return true;
	if (row)
		db.query<unknown, [string]>("DELETE FROM settings WHERE key = ?").run(key);
	return false;
}

export function clearNativeConnectInProgress(db: Database) {
	db.query<unknown, [string]>("DELETE FROM settings WHERE key = ?").run(key);
}
