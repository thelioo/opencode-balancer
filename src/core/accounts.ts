import type { Database } from "bun:sqlite";
import { now } from "./time";
import type { Account, AuthInfo, SelectedModel } from "./types";

type AccountRow = {
	provider_id: string;
	alias: string;
	auth_json: string;
	auth_type: string;
	created_at: number;
	updated_at: number;
	last_used_at: number | null;
	rate_limited_until: number | null;
	failures: number;
	disabled: number;
};

const authTypes = ["api", "oauth", "wellknown"] as const;

export function normalizeAlias(alias: string) {
	return alias
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9._-]+/g, "-")
		.replace(/^-+|-+$/g, "");
}

function accountRowID(row: AccountRow) {
	return `${row.provider_id}/${row.alias}`;
}

function isAuthType(value: string): value is AuthInfo["type"] {
	return authTypes.includes(value as AuthInfo["type"]);
}

function parseAccountAuth(row: AccountRow): AuthInfo {
	const id = accountRowID(row);
	let auth: unknown;
	try {
		auth = JSON.parse(row.auth_json);
	} catch {
		throw new Error(`Invalid account row for ${id}: auth_json is invalid`);
	}

	if (
		!auth ||
		typeof auth !== "object" ||
		!("type" in auth) ||
		typeof auth.type !== "string"
	) {
		throw new Error(`Invalid account row for ${id}: auth_json type is invalid`);
	}
	if (!isAuthType(auth.type)) {
		throw new Error(
			`Invalid account row for ${id}: auth_json type ${auth.type} is invalid`,
		);
	}
	return auth as AuthInfo;
}

function validateAccountAuthType(row: AccountRow): AuthInfo["type"] {
	if (!isAuthType(row.auth_type)) {
		throw new Error(
			`Invalid account row for ${accountRowID(row)}: auth_type ${row.auth_type} is invalid`,
		);
	}
	return row.auth_type;
}

function validateDisabled(row: AccountRow) {
	if (row.disabled !== 0 && row.disabled !== 1) {
		throw new Error(
			`Invalid account row for ${accountRowID(row)}: disabled ${row.disabled} is invalid`,
		);
	}
	return Boolean(row.disabled);
}

function accountFromRow(row: AccountRow): Account {
	const auth = parseAccountAuth(row);
	const authType = validateAccountAuthType(row);
	if (auth.type !== authType) {
		throw new Error(
			`Invalid account row for ${accountRowID(row)}: auth_type ${authType} does not match auth_json type ${auth.type}`,
		);
	}

	return {
		alias: row.alias,
		auth,
		authType,
		createdAt: row.created_at,
		disabled: validateDisabled(row),
		failures: row.failures,
		lastUsedAt: row.last_used_at ?? undefined,
		providerID: row.provider_id,
		rateLimitedUntil: row.rate_limited_until ?? undefined,
		updatedAt: row.updated_at,
	};
}

function setActiveAlias(db: Database, providerID: string, alias: string) {
	db.query<unknown, [string, string, number]>(
		`INSERT INTO provider_state (provider_id, active_alias, updated_at, metadata_json)
         VALUES (?, ?, ?, '{}')
         ON CONFLICT(provider_id) DO UPDATE SET
             active_alias = excluded.active_alias,
             updated_at = excluded.updated_at`,
	).run(providerID, alias, now());
	db.query<unknown, [string]>(
		`INSERT INTO settings (key, value) VALUES ('selected_provider_id', ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
	).run(providerID);
}

function parseMetadataJson(
	value: string | null | undefined,
): Record<string, unknown> {
	if (!value) return {};
	try {
		const metadata = JSON.parse(value);
		return metadata && typeof metadata === "object" && !Array.isArray(metadata)
			? metadata
			: {};
	} catch {
		return {};
	}
}

export function saveAccount(
	db: Database,
	providerID: string,
	aliasInput: string,
	auth: AuthInfo,
): Account {
	const alias = normalizeAlias(aliasInput);
	if (!alias) throw new Error("Invalid alias");

	const save = db.transaction(() => {
		const timestamp = now();
		db.query<
			unknown,
			[string, string, string, string, number, number, number, number]
		>(
			`INSERT INTO accounts (
                 provider_id,
                 alias,
                 auth_json,
                 auth_type,
                 created_at,
                 updated_at,
                 failures,
                 disabled
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(provider_id, alias) DO UPDATE SET
                 auth_json = excluded.auth_json,
                 auth_type = excluded.auth_type,
                 updated_at = excluded.updated_at`,
		).run(
			providerID,
			alias,
			JSON.stringify(auth),
			auth.type,
			timestamp,
			timestamp,
			0,
			0,
		);
		setActiveAlias(db, providerID, alias);

		const account = getAccount(db, providerID, alias);
		if (!account) throw new Error(`Account not found: ${providerID}/${alias}`);
		return account;
	});

	return save();
}

export function updateAccountAuth(
	db: Database,
	providerID: string,
	aliasInput: string,
	auth: AuthInfo,
): Account | undefined {
	const alias = normalizeAlias(aliasInput);
	if (!alias) throw new Error("Invalid alias");

	db.query<unknown, [string, string, number, string, string]>(
		`UPDATE accounts
         SET auth_json = ?,
             auth_type = ?,
             updated_at = ?
         WHERE provider_id = ? AND alias = ?`,
	).run(JSON.stringify(auth), auth.type, now(), providerID, alias);
	return getAccount(db, providerID, alias);
}

export function renameAccount(
	db: Database,
	providerID: string,
	fromAliasInput: string,
	toAliasInput: string,
): Account {
	const fromAlias = normalizeAlias(fromAliasInput);
	const toAlias = normalizeAlias(toAliasInput);
	if (!fromAlias || !toAlias) throw new Error("Invalid alias");
	if (fromAlias === toAlias) {
		const account = getAccount(db, providerID, fromAlias);
		if (!account)
			throw new Error(`Account not found: ${providerID}/${fromAlias}`);
		return account;
	}

	const rename = db.transaction(() => {
		const existing = getAccount(db, providerID, fromAlias);
		if (!existing)
			throw new Error(`Account not found: ${providerID}/${fromAlias}`);
		if (getAccount(db, providerID, toAlias))
			throw new Error(`Account already exists: ${providerID}/${toAlias}`);

		db.query<unknown, [string, number, string, string]>(
			`UPDATE accounts
             SET alias = ?, updated_at = ?
             WHERE provider_id = ? AND alias = ?`,
		).run(toAlias, now(), providerID, fromAlias);
		db.query<unknown, [string, string, string]>(
			`UPDATE usage_snapshots
             SET alias = ?
             WHERE provider_id = ? AND alias = ?`,
		).run(toAlias, providerID, fromAlias);

		const active = db
			.query<{ active_alias: string | null }, [string]>(
				"SELECT active_alias FROM provider_state WHERE provider_id = ?",
			)
			.get(providerID);
		if (active?.active_alias === fromAlias)
			setActiveAlias(db, providerID, toAlias);

		const account = getAccount(db, providerID, toAlias);
		if (!account)
			throw new Error(`Account not found: ${providerID}/${toAlias}`);
		return account;
	});

	return rename();
}

export function getAccount(
	db: Database,
	providerID: string,
	alias: string,
): Account | undefined {
	const normalizedAlias = normalizeAlias(alias);
	const row = db
		.query<AccountRow, [string, string]>(
			`SELECT provider_id, alias, auth_json, auth_type, created_at, updated_at,
                    last_used_at, rate_limited_until, failures, disabled
             FROM accounts
             WHERE provider_id = ? AND alias = ?`,
		)
		.get(providerID, normalizedAlias);
	return row ? accountFromRow(row) : undefined;
}

export function listAccounts(db: Database, providerID?: string): Account[] {
	const sql = `SELECT provider_id, alias, auth_json, auth_type, created_at, updated_at,
                        last_used_at, rate_limited_until, failures, disabled
                 FROM accounts`;
	const rows = providerID
		? db
				.query<AccountRow, [string]>(
					`${sql} WHERE provider_id = ? ORDER BY alias`,
				)
				.all(providerID)
		: db.query<AccountRow, []>(`${sql} ORDER BY provider_id, alias`).all();
	return rows.map(accountFromRow);
}

export function setActiveAccount(
	db: Database,
	providerID: string,
	alias: string,
): Account {
	const normalizedAlias = normalizeAlias(alias);
	const account = getAccount(db, providerID, normalizedAlias);
	if (!account)
		throw new Error(`Account not found: ${providerID}/${normalizedAlias}`);

	setActiveAlias(db, providerID, normalizedAlias);
	return account;
}

export function removeAccount(db: Database, providerID: string, alias: string) {
	const normalizedAlias = normalizeAlias(alias);
	const remove = db.transaction(() => {
		const existing = getAccount(db, providerID, normalizedAlias);
		if (!existing) return false;

		db.query<unknown, [string, string]>(
			"DELETE FROM accounts WHERE provider_id = ? AND alias = ?",
		).run(providerID, normalizedAlias);
		db.query<unknown, [string, string]>(
			"DELETE FROM usage_snapshots WHERE provider_id = ? AND alias = ?",
		).run(providerID, normalizedAlias);

		const active = db
			.query<{ active_alias: string | null }, [string]>(
				"SELECT active_alias FROM provider_state WHERE provider_id = ?",
			)
			.get(providerID);
		if (active?.active_alias === normalizedAlias) {
			const next = db
				.query<{ alias: string }, [string]>(
					"SELECT alias FROM accounts WHERE provider_id = ? ORDER BY alias LIMIT 1",
				)
				.get(providerID);
			db.query<unknown, [string | null, number, string]>(
				`UPDATE provider_state
                 SET active_alias = ?, updated_at = ?
                 WHERE provider_id = ?`,
			).run(next?.alias ?? null, now(), providerID);
		}

		return true;
	});

	return remove();
}

export function getActiveAccount(
	db: Database,
	providerID: string,
): Account | undefined {
	const row = db
		.query<{ active_alias: string | null }, [string]>(
			"SELECT active_alias FROM provider_state WHERE provider_id = ?",
		)
		.get(providerID);
	if (!row?.active_alias) return undefined;
	return getAccount(db, providerID, row.active_alias);
}

export function getSelectedAccount(db: Database): Account | undefined {
	const selectedProvider = db
		.query<{ value: string }, []>(
			"SELECT value FROM settings WHERE key = 'selected_provider_id'",
		)
		.get();
	if (selectedProvider?.value) {
		const active = getActiveAccount(db, selectedProvider.value);
		if (active) return active;
	}

	const row = db
		.query<{ provider_id: string; active_alias: string }, []>(
			`SELECT provider_id, active_alias
             FROM provider_state
             WHERE active_alias IS NOT NULL
             ORDER BY updated_at DESC, provider_id
             LIMIT 1`,
		)
		.get();
	if (!row?.active_alias) return undefined;
	return getAccount(db, row.provider_id, row.active_alias);
}

export function setSelectedModel(
	db: Database,
	providerID: string,
	modelID: string,
): SelectedModel {
	const row = db
		.query<{ metadata_json: string | null }, [string]>(
			"SELECT metadata_json FROM provider_state WHERE provider_id = ?",
		)
		.get(providerID);
	const metadata = parseMetadataJson(row?.metadata_json);
	metadata.selected_model_id = modelID;

	db.query<unknown, [string, number, string]>(
		`INSERT INTO provider_state (provider_id, active_alias, updated_at, metadata_json)
         VALUES (?, NULL, ?, ?)
         ON CONFLICT(provider_id) DO UPDATE SET
             updated_at = excluded.updated_at,
             metadata_json = excluded.metadata_json`,
	).run(providerID, now(), JSON.stringify(metadata));

	return { modelID, providerID };
}

export function getSelectedModel(
	db: Database,
	providerID: string,
): SelectedModel | undefined {
	const row = db
		.query<{ metadata_json: string | null }, [string]>(
			"SELECT metadata_json FROM provider_state WHERE provider_id = ?",
		)
		.get(providerID);
	const modelID = parseMetadataJson(row?.metadata_json).selected_model_id;
	if (typeof modelID !== "string" || modelID.length === 0) return undefined;
	return { modelID, providerID };
}
