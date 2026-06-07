import type { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { saveAccount } from "./accounts";
import { now } from "./time";
import type { AuthInfo, PendingConnection } from "./types";

type PendingConnectionRow = {
	id: string;
	provider_id: string;
	auth_json: string;
	auth_type: string;
	source: string;
	captured_at: number;
	prompt_status: string;
};

type PendingIdentity = {
	providerID: string;
	auth: AuthInfo;
	source: PendingConnection["source"];
};

const pendingSources = ["auth-file", "http", "oauth-callback"] as const;
const promptStatuses = ["new", "prompted", "dismissed"] as const;
const authTypes = ["api", "oauth", "wellknown"] as const;

function isAuthType(value: string): value is AuthInfo["type"] {
	return authTypes.includes(value as AuthInfo["type"]);
}

function parsePendingAuth(row: PendingConnectionRow): AuthInfo {
	let auth: unknown;
	try {
		auth = JSON.parse(row.auth_json);
	} catch {
		throw new Error(
			`Invalid pending connection row ${row.id}: auth_json is invalid`,
		);
	}

	if (
		!auth ||
		typeof auth !== "object" ||
		!("type" in auth) ||
		typeof auth.type !== "string"
	) {
		throw new Error(
			`Invalid pending connection row ${row.id}: auth_json type is invalid`,
		);
	}
	if (!isAuthType(auth.type)) {
		throw new Error(
			`Invalid pending connection row ${row.id}: auth_json type ${auth.type} is invalid`,
		);
	}
	return auth as AuthInfo;
}

function validatePendingAuthType(row: PendingConnectionRow): AuthInfo["type"] {
	if (!isAuthType(row.auth_type)) {
		throw new Error(
			`Invalid pending connection row ${row.id}: auth_type ${row.auth_type} is invalid`,
		);
	}
	return row.auth_type;
}

function validatePendingSource(
	row: PendingConnectionRow,
): PendingConnection["source"] {
	if (!pendingSources.includes(row.source as PendingConnection["source"])) {
		throw new Error(
			`Invalid pending connection row ${row.id}: source ${row.source} is invalid`,
		);
	}
	return row.source as PendingConnection["source"];
}

function validatePromptStatus(
	row: PendingConnectionRow,
): PendingConnection["promptStatus"] {
	if (
		!promptStatuses.includes(
			row.prompt_status as PendingConnection["promptStatus"],
		)
	) {
		throw new Error(
			`Invalid pending connection row ${row.id}: prompt_status ${row.prompt_status} is invalid`,
		);
	}
	return row.prompt_status as PendingConnection["promptStatus"];
}

function pendingConnectionFromRow(
	row: PendingConnectionRow,
): PendingConnection {
	const auth = parsePendingAuth(row);
	const authType = validatePendingAuthType(row);
	if (auth.type !== authType) {
		throw new Error(
			`Invalid pending connection row ${row.id}: auth_type ${authType} does not match auth_json type ${auth.type}`,
		);
	}

	return {
		auth,
		authType,
		capturedAt: row.captured_at,
		id: row.id,
		promptStatus: validatePromptStatus(row),
		providerID: row.provider_id,
		source: validatePendingSource(row),
	};
}

function authIdentityKey(auth: AuthInfo) {
	if (auth.type === "api") return `api\0${auth.key}`;
	if (auth.type === "wellknown") return `wellknown\0${auth.key}\0${auth.token}`;
	const accountID = oauthAccountID(auth);
	return accountID
		? `oauth-account\0${accountID}`
		: `oauth-refresh\0${auth.refresh}`;
}

function decodeJwtPayload(token: string): Record<string, unknown> | undefined {
	const payload = token.split(".")[1];
	if (!payload) return undefined;
	try {
		const decoded = JSON.parse(
			Buffer.from(payload, "base64url").toString("utf8"),
		) as unknown;
		return decoded && typeof decoded === "object" && !Array.isArray(decoded)
			? (decoded as Record<string, unknown>)
			: undefined;
	} catch {
		return undefined;
	}
}

function oauthAccountID(auth: Extract<AuthInfo, { type: "oauth" }>) {
	if (auth.accountId) return auth.accountId;
	const claim = decodeJwtPayload(auth.access)?.["https://api.openai.com/auth"];
	if (!claim || typeof claim !== "object" || Array.isArray(claim))
		return undefined;
	const accountID = (claim as Record<string, unknown>).chatgpt_account_id;
	return typeof accountID === "string" && accountID.length > 0
		? accountID
		: undefined;
}

function samePendingIdentity(auth: AuthInfo, other: AuthInfo) {
	return authIdentityKey(auth) === authIdentityKey(other);
}

function pendingID(
	providerID: string,
	auth: AuthInfo,
	source: PendingConnection["source"],
) {
	const hash = createHash("sha256")
		.update(`${providerID}\0${source}\0${authIdentityKey(auth)}`)
		.digest("hex")
		.slice(0, 32);
	return `pending-${hash}`;
}

export function pendingPromptGroupID(db: Database, id: string) {
	const row = selectPendingRow(db, id);
	if (!row) return undefined;
	const identity = pendingIdentity(row);
	return `${identity.providerID}\0${identity.source}\0${authIdentityKey(identity.auth)}`;
}

function selectPendingRow(db: Database, id: string) {
	return db
		.query<PendingConnectionRow, [string]>(
			`SELECT id, provider_id, auth_json, auth_type, source, captured_at, prompt_status
             FROM pending_connections
             WHERE id = ?`,
		)
		.get(id);
}

function pendingIdentity(row: PendingConnectionRow): PendingIdentity {
	return {
		auth: parsePendingAuth(row),
		providerID: row.provider_id,
		source: validatePendingSource(row),
	};
}

function equivalentPendingRows(db: Database, identity: PendingIdentity) {
	return db
		.query<PendingConnectionRow, [string, string, string]>(
			`SELECT id, provider_id, auth_json, auth_type, source, captured_at, prompt_status
             FROM pending_connections
             WHERE provider_id = ? AND source = ? AND auth_type = ?`,
		)
		.all(identity.providerID, identity.source, identity.auth.type)
		.filter((row) => samePendingIdentity(parsePendingAuth(row), identity.auth));
}

export function createPendingConnection(
	db: Database,
	providerID: string,
	auth: AuthInfo,
	source: PendingConnection["source"],
): PendingConnection {
	const authJSON = JSON.stringify(auth);
	const identity = { auth, providerID, source } satisfies PendingIdentity;
	const existing = equivalentPendingRows(db, identity)[0];
	if (existing) return pendingConnectionFromRow(existing);

	const pending: PendingConnection = {
		auth,
		authType: auth.type,
		capturedAt: now(),
		id: pendingID(providerID, auth, source),
		promptStatus: "new",
		providerID,
		source,
	};

	db.query<unknown, [string, string, string, string, string, number, string]>(
		`INSERT INTO pending_connections (
             id,
             provider_id,
             auth_json,
             auth_type,
             source,
             captured_at,
             prompt_status
         ) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO NOTHING`,
	).run(
		pending.id,
		pending.providerID,
		authJSON,
		pending.authType,
		pending.source,
		pending.capturedAt,
		pending.promptStatus,
	);

	const row = selectPendingRow(db, pending.id);
	return row ? pendingConnectionFromRow(row) : pending;
}

export function claimPendingPrompt(db: Database, id: string) {
	const claim = db.transaction(() => {
		const row = selectPendingRow(db, id);
		if (!row) return undefined;
		const identity = pendingIdentity(row);
		const equivalent = equivalentPendingRows(db, identity);
		const ids = equivalent.map((pending) => pending.id);
		const result = db
			.query<unknown, string[]>(
				`UPDATE pending_connections
                 SET prompt_status = 'prompted'
                 WHERE id IN (${ids.map(() => "?").join(", ")})
                    AND prompt_status = 'new'`,
			)
			.run(...ids);
		if (result.changes === 0) return undefined;
		return pendingConnectionFromRow({ ...row, prompt_status: "prompted" });
	});

	return claim();
}

export function releasePendingPrompt(db: Database, id: string) {
	const release = db.transaction(() => {
		const row = selectPendingRow(db, id);
		if (!row) return false;
		const identity = pendingIdentity(row);
		const ids = equivalentPendingRows(db, identity).map(
			(pending) => pending.id,
		);
		if (ids.length === 0) return false;
		const result = db
			.query<unknown, string[]>(
				`UPDATE pending_connections
                 SET prompt_status = 'new'
                 WHERE id IN (${ids.map(() => "?").join(", ")})
                    AND prompt_status = 'prompted'`,
			)
			.run(...ids);
		return result.changes > 0;
	});

	return release();
}

export function listPendingConnections(db: Database): PendingConnection[] {
	const rows = db
		.query<PendingConnectionRow, []>(
			`SELECT id, provider_id, auth_json, auth_type, source, captured_at, prompt_status
             FROM pending_connections
             ORDER BY captured_at DESC, id DESC`,
		)
		.all();
	return rows.map(pendingConnectionFromRow);
}

export function completePendingConnection(
	db: Database,
	id: string,
	alias: string,
) {
	const complete = db.transaction(() => {
		const row = selectPendingRow(db, id);
		if (!row) throw new Error(`Pending connection not found: ${id}`);

		const pending = pendingConnectionFromRow(row);
		const account = saveAccount(db, pending.providerID, alias, pending.auth);
		const identity = pendingIdentity(row);
		const ids = equivalentPendingRows(db, identity).map(
			(pending) => pending.id,
		);
		db.query<unknown, string[]>(
			`DELETE FROM pending_connections
             WHERE id IN (${ids.map(() => "?").join(", ")})`,
		).run(...ids);
		return account;
	});

	return complete();
}

export function removePendingConnection(db: Database, id: string) {
	const remove = db.transaction(() => {
		const row = selectPendingRow(db, id);
		if (!row) return false;
		const identity = pendingIdentity(row);
		const ids = equivalentPendingRows(db, identity).map(
			(pending) => pending.id,
		);
		if (ids.length === 0) return false;
		const result = db
			.query<unknown, string[]>(
				`UPDATE pending_connections
                 SET prompt_status = 'dismissed'
                 WHERE id IN (${ids.map(() => "?").join(", ")})
                    AND prompt_status != 'dismissed'`,
			)
			.run(...ids);
		return result.changes > 0;
	});

	return remove();
}
