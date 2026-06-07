import type { Database } from "bun:sqlite";

const authTypes = new Set(["api", "oauth", "wellknown"]);

function hasMigration(db: Database, version: number) {
	const row = db
		.query<{ version: number }, [number]>(
			"SELECT version FROM schema_migrations WHERE version = ?",
		)
		.get(version);
	return Boolean(row);
}

function hasTable(db: Database, table: string) {
	const row = db
		.query<{ name: string }, [string]>(
			"SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
		)
		.get(table);
	return Boolean(row);
}

function tableColumns(db: Database, table: string) {
	if (!hasTable(db, table)) return new Set<string>();
	return new Set(
		db
			.query<{ name: string }, []>(`PRAGMA table_info(${table})`)
			.all()
			.map((row) => row.name),
	);
}

function inferAuthType(authJSON: string) {
	try {
		const parsed = JSON.parse(authJSON) as { type?: unknown };
		if (typeof parsed.type === "string" && authTypes.has(parsed.type))
			return parsed.type;
	} catch {
		// Invalid legacy rows will be rejected by row validation when read.
	}
	return "api";
}

function selectExisting(db: Database, table: string, columns: string[]) {
	const existing = tableColumns(db, table);
	const selected = columns.filter((column) => existing.has(column));
	if (selected.length === 0) return [];
	return db
		.query<Record<string, unknown>, []>(
			`SELECT ${selected.join(", ")} FROM ${table}`,
		)
		.all();
}

function recreateAccounts(db: Database) {
	const rows = selectExisting(db, "accounts", [
		"provider_id",
		"alias",
		"auth_json",
		"auth_type",
		"created_at",
		"updated_at",
		"last_used_at",
		"rate_limited_until",
		"failures",
		"disabled",
	]);

	db.exec(`
        DROP TABLE IF EXISTS accounts_new;
        CREATE TABLE accounts_new (
            provider_id TEXT NOT NULL,
            alias TEXT NOT NULL,
            auth_json TEXT NOT NULL,
            auth_type TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            last_used_at INTEGER,
            rate_limited_until INTEGER,
            failures INTEGER NOT NULL DEFAULT 0,
            disabled INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (provider_id, alias)
        );
    `);

	const insert = db.query<
		unknown,
		[
			string,
			string,
			string,
			string,
			number,
			number,
			number | null,
			number | null,
			number,
			number,
		]
	>(
		`INSERT OR REPLACE INTO accounts_new (
             provider_id, alias, auth_json, auth_type, created_at, updated_at,
             last_used_at, rate_limited_until, failures, disabled
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
	);
	for (const row of rows) {
		if (
			typeof row.provider_id !== "string" ||
			typeof row.alias !== "string" ||
			typeof row.auth_json !== "string"
		)
			continue;
		const authType =
			typeof row.auth_type === "string" && authTypes.has(row.auth_type)
				? row.auth_type
				: inferAuthType(row.auth_json);
		insert.run(
			row.provider_id,
			row.alias,
			row.auth_json,
			authType,
			typeof row.created_at === "number" ? row.created_at : Date.now(),
			typeof row.updated_at === "number" ? row.updated_at : Date.now(),
			typeof row.last_used_at === "number" ? row.last_used_at : null,
			typeof row.rate_limited_until === "number"
				? row.rate_limited_until
				: null,
			typeof row.failures === "number" ? row.failures : 0,
			row.disabled === 1 ? 1 : 0,
		);
	}

	db.exec(`
        DROP TABLE IF EXISTS accounts;
        ALTER TABLE accounts_new RENAME TO accounts;
    `);
}

function recreateProviderState(db: Database) {
	const rows = selectExisting(db, "provider_state", [
		"provider_id",
		"active_alias",
		"updated_at",
		"metadata_json",
	]);

	db.exec(`
        DROP TABLE IF EXISTS provider_state_new;
        CREATE TABLE provider_state_new (
            provider_id TEXT PRIMARY KEY,
            active_alias TEXT,
            updated_at INTEGER NOT NULL,
            metadata_json TEXT NOT NULL DEFAULT '{}'
        );
    `);

	const insert = db.query<unknown, [string, string | null, number, string]>(
		`INSERT OR REPLACE INTO provider_state_new (provider_id, active_alias, updated_at, metadata_json)
         VALUES (?, ?, ?, ?)`,
	);
	for (const row of rows) {
		if (typeof row.provider_id !== "string") continue;
		insert.run(
			row.provider_id,
			typeof row.active_alias === "string" ? row.active_alias : null,
			typeof row.updated_at === "number" ? row.updated_at : Date.now(),
			typeof row.metadata_json === "string" ? row.metadata_json : "{}",
		);
	}

	db.exec(`
        DROP TABLE IF EXISTS provider_state;
        ALTER TABLE provider_state_new RENAME TO provider_state;
    `);
}

function recreatePendingConnections(db: Database) {
	const rows = selectExisting(db, "pending_connections", [
		"id",
		"provider_id",
		"auth_json",
		"auth_type",
		"source",
		"captured_at",
		"prompt_status",
	]);

	db.exec(`
        DROP TABLE IF EXISTS pending_connections_new;
        CREATE TABLE pending_connections_new (
            id TEXT PRIMARY KEY,
            provider_id TEXT NOT NULL,
            auth_json TEXT NOT NULL,
            auth_type TEXT NOT NULL,
            source TEXT NOT NULL,
            captured_at INTEGER NOT NULL,
            prompt_status TEXT NOT NULL
        );
    `);

	const insert = db.query<
		unknown,
		[string, string, string, string, string, number, string]
	>(
		`INSERT OR REPLACE INTO pending_connections_new (
             id, provider_id, auth_json, auth_type, source, captured_at, prompt_status
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
	);
	for (const row of rows) {
		if (
			typeof row.id !== "string" ||
			typeof row.provider_id !== "string" ||
			typeof row.auth_json !== "string"
		)
			continue;
		const authType =
			typeof row.auth_type === "string" && authTypes.has(row.auth_type)
				? row.auth_type
				: inferAuthType(row.auth_json);
		insert.run(
			row.id,
			row.provider_id,
			row.auth_json,
			authType,
			typeof row.source === "string" ? row.source : "auth-file",
			typeof row.captured_at === "number" ? row.captured_at : Date.now(),
			typeof row.prompt_status === "string" ? row.prompt_status : "new",
		);
	}

	db.exec(`
        DROP TABLE IF EXISTS pending_connections;
        ALTER TABLE pending_connections_new RENAME TO pending_connections;
    `);
}

function recreateUsageSnapshots(db: Database) {
	const rows = selectExisting(db, "usage_snapshots", [
		"provider_id",
		"alias",
		"fetched_at",
		"confidence",
		"normalized_json",
		"raw_redacted_json",
		"error",
	]);

	db.exec(`
        DROP TABLE IF EXISTS usage_snapshots_new;
        CREATE TABLE usage_snapshots_new (
            provider_id TEXT NOT NULL,
            alias TEXT NOT NULL,
            fetched_at INTEGER NOT NULL,
            confidence TEXT NOT NULL,
            normalized_json TEXT NOT NULL,
            raw_redacted_json TEXT,
            error TEXT,
            PRIMARY KEY (provider_id, alias)
        );
    `);

	const insert = db.query<
		unknown,
		[string, string, number, string, string, string | null, string | null]
	>(
		`INSERT OR REPLACE INTO usage_snapshots_new (
             provider_id, alias, fetched_at, confidence, normalized_json, raw_redacted_json, error
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
	);
	for (const row of rows) {
		if (typeof row.provider_id !== "string" || typeof row.alias !== "string")
			continue;
		insert.run(
			row.provider_id,
			row.alias,
			typeof row.fetched_at === "number" ? row.fetched_at : Date.now(),
			typeof row.confidence === "string" ? row.confidence : "unavailable",
			typeof row.normalized_json === "string" ? row.normalized_json : "{}",
			typeof row.raw_redacted_json === "string" ? row.raw_redacted_json : null,
			typeof row.error === "string" ? row.error : null,
		);
	}

	db.exec(`
        DROP TABLE IF EXISTS usage_snapshots;
        ALTER TABLE usage_snapshots_new RENAME TO usage_snapshots;
    `);
}

function recreateEvents(db: Database) {
	const rows = selectExisting(db, "events", [
		"id",
		"type",
		"provider_id",
		"alias",
		"message",
		"created_at",
		"metadata_json",
	]);

	db.exec(`
        DROP TABLE IF EXISTS events_new;
        CREATE TABLE events_new (
            id TEXT PRIMARY KEY,
            type TEXT NOT NULL,
            provider_id TEXT,
            alias TEXT,
            message TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            metadata_json TEXT NOT NULL DEFAULT '{}'
        );
    `);

	const insert = db.query<
		unknown,
		[string, string, string | null, string | null, string, number, string]
	>(
		`INSERT OR REPLACE INTO events_new (id, type, provider_id, alias, message, created_at, metadata_json)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
	);
	for (const row of rows) {
		if (
			typeof row.id !== "string" ||
			typeof row.type !== "string" ||
			typeof row.message !== "string"
		)
			continue;
		insert.run(
			row.id,
			row.type,
			typeof row.provider_id === "string" ? row.provider_id : null,
			typeof row.alias === "string" ? row.alias : null,
			row.message,
			typeof row.created_at === "number" ? row.created_at : Date.now(),
			typeof row.metadata_json === "string" ? row.metadata_json : "{}",
		);
	}

	db.exec(`
        DROP TABLE IF EXISTS events;
        ALTER TABLE events_new RENAME TO events;
    `);
}

function recreateProviderPriority(db: Database) {
	const rows = selectExisting(db, "provider_priority", [
		"provider_id",
		"position",
		"model_id",
		"enabled",
		"updated_at",
	]);

	db.exec(`
        DROP TABLE IF EXISTS provider_priority_new;
        CREATE TABLE provider_priority_new (
            provider_id TEXT PRIMARY KEY,
            position INTEGER NOT NULL,
            model_id TEXT,
            enabled INTEGER NOT NULL DEFAULT 1,
            updated_at INTEGER NOT NULL
        );
    `);

	const insert = db.query<
		unknown,
		[string, number, string | null, number, number]
	>(
		`INSERT OR REPLACE INTO provider_priority_new (provider_id, position, model_id, enabled, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
	);
	for (const row of rows) {
		if (typeof row.provider_id !== "string") continue;
		insert.run(
			row.provider_id,
			typeof row.position === "number" ? row.position : 0,
			typeof row.model_id === "string" ? row.model_id : null,
			row.enabled === 0 ? 0 : 1,
			typeof row.updated_at === "number" ? row.updated_at : Date.now(),
		);
	}

	db.exec(`
        DROP TABLE IF EXISTS provider_priority;
        ALTER TABLE provider_priority_new RENAME TO provider_priority;
    `);
}

function recreateSettings(db: Database) {
	const rows = selectExisting(db, "settings", ["key", "value"]);

	db.exec(`
        DROP TABLE IF EXISTS settings_new;
        CREATE TABLE settings_new (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
    `);

	const insert = db.query<unknown, [string, string]>(
		`INSERT OR REPLACE INTO settings_new (key, value) VALUES (?, ?)`,
	);
	for (const row of rows) {
		if (typeof row.key !== "string" || typeof row.value !== "string") continue;
		insert.run(row.key, row.value);
	}

	db.exec(`
        DROP TABLE IF EXISTS settings;
        ALTER TABLE settings_new RENAME TO settings;
    `);
}

export function migrate(db: Database) {
	db.exec(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
            version INTEGER PRIMARY KEY,
            applied_at INTEGER NOT NULL
        );
    `);

	const apply = db.transaction(() => {
		recreateAccounts(db);
		recreateProviderState(db);
		recreatePendingConnections(db);
		recreateUsageSnapshots(db);
		recreateEvents(db);
		recreateProviderPriority(db);
		recreateSettings(db);

		if (!hasMigration(db, 1)) {
			db.query(
				"INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)",
			).run(1, Date.now());
		}
	});

	apply();
}
