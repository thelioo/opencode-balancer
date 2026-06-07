import type { Database } from "bun:sqlite";
import { existsSync, readFileSync } from "node:fs";
import { getActiveAccount, listAccounts, updateAccountAuth } from "../core/accounts";
import { isNativeAuthCaptureSuppressed as isDbNativeAuthCaptureSuppressed } from "../core/native-auth-suppression";
import { nativeAuthPath } from "../core/path";
import { createPendingConnection } from "../core/pending";
import type { AuthInfo } from "../core/types";
import { isNativeAuthCaptureSuppressed, showToast as defaultShowToast } from "./native";

let started = false;

type NativeAuthReadResult =
    | { ok: true; auth: Record<string, AuthInfo> }
    | { ok: false };

type ToastVariant = "info" | "success" | "warning" | "error";

type AuthWatcherOptions = {
    db: Database;
    client: any;
    initialSnapshot?: Record<string, AuthInfo>;
    readAuth: () => NativeAuthReadResult;
    showToast?: (
        client: any,
        message: string,
        variant: ToastVariant,
    ) => Promise<void>;
    createPending?: (
        db: Database,
        providerID: string,
        auth: AuthInfo,
        source: "auth-file",
    ) => unknown;
    isSuppressed?: (providerID: string) => boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringMetadata(value: unknown) {
    if (value === undefined) return { ok: true as const, metadata: undefined };
    if (!isRecord(value)) return { ok: false as const };

    const metadata: Record<string, string> = {};
    for (const [key, entry] of Object.entries(value)) {
        if (typeof entry !== "string") return { ok: false as const };
        metadata[key] = entry;
    }
    return { ok: true as const, metadata };
}

function attachMetadata<T extends AuthInfo>(auth: T, value: unknown): T | undefined {
    const result = stringMetadata(value);
    if (!result.ok) return undefined;
    if (result.metadata) auth.metadata = result.metadata;
    return auth;
}

function parseAuthInfo(value: unknown): AuthInfo | undefined {
    if (!isRecord(value) || typeof value.type !== "string") return undefined;

    if (value.type === "api" && typeof value.key === "string") {
        return attachMetadata({ type: "api", key: value.key }, value.metadata);
    }

    if (
        value.type === "oauth" &&
        typeof value.refresh === "string" &&
        typeof value.access === "string" &&
        typeof value.expires === "number" &&
        Number.isFinite(value.expires)
    ) {
        const auth: AuthInfo = {
            type: "oauth",
            refresh: value.refresh,
            access: value.access,
            expires: value.expires,
        };
        if (typeof value.accountId === "string") auth.accountId = value.accountId;
        if (typeof value.enterpriseUrl === "string") auth.enterpriseUrl = value.enterpriseUrl;
        return attachMetadata(auth, value.metadata);
    }

    if (
        value.type === "wellknown" &&
        typeof value.key === "string" &&
        typeof value.token === "string"
    ) {
        return attachMetadata(
            { type: "wellknown", key: value.key, token: value.token },
            value.metadata,
        );
    }

    return undefined;
}

function parseNativeAuthContent(content: string): NativeAuthReadResult {
    let raw: unknown;
    try {
        raw = JSON.parse(content);
    } catch {
        return { ok: false };
    }

    if (!isRecord(raw)) return { ok: false };

    const authByProvider: Record<string, AuthInfo> = {};
    for (const [providerID, auth] of Object.entries(raw)) {
        const parsed = parseAuthInfo(auth);
        if (!parsed) return { ok: false };
        authByProvider[providerID] = parsed;
    }
    return { ok: true, auth: authByProvider };
}

export function readNativeAuth(): NativeAuthReadResult {
    const authContent = Bun.env.OPENCODE_AUTH_CONTENT;
    if (authContent !== undefined) return parseNativeAuthContent(authContent);

    const path = nativeAuthPath();
    if (!existsSync(path)) return { ok: true, auth: {} };

    try {
        return parseNativeAuthContent(readFileSync(path, "utf8"));
    } catch {
        return { ok: false };
    }
}

function authChanged(previous: AuthInfo | undefined, current: AuthInfo) {
    return JSON.stringify(previous ?? null) !== JSON.stringify(current);
}

function decodeJwtPayload(token: string): Record<string, unknown> | undefined {
    const payload = token.split(".")[1];
    if (!payload) return undefined;
    try {
        const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as unknown;
        return isRecord(decoded) ? decoded : undefined;
    } catch {
        return undefined;
    }
}

function oauthAccountID(auth: Extract<AuthInfo, { type: "oauth" }>) {
    if (auth.accountId) return auth.accountId;
    const claim = decodeJwtPayload(auth.access)?.["https://api.openai.com/auth"];
    if (!isRecord(claim)) return undefined;
    const accountID = claim.chatgpt_account_id;
    return typeof accountID === "string" && accountID.length > 0 ? accountID : undefined;
}

export function sameSavedAuth(saved: AuthInfo, current: AuthInfo) {
    if (saved.type !== current.type) return false;
    if (saved.type === "api" && current.type === "api") return saved.key === current.key;
    if (saved.type === "wellknown" && current.type === "wellknown") return saved.key === current.key && saved.token === current.token;
    if (saved.type === "oauth" && current.type === "oauth") {
        const savedAccountID = oauthAccountID(saved);
        const currentAccountID = oauthAccountID(current);
        if (savedAccountID && currentAccountID) return savedAccountID === currentAccountID;
        return saved.refresh === current.refresh;
    }
    return false;
}

function saveKnownNativeAuth(db: Database, providerID: string, auth: AuthInfo) {
    const account = listAccounts(db, providerID).find((candidate) => sameSavedAuth(candidate.auth, auth));
    if (!account) return false;
    updateAccountAuth(db, providerID, account.alias, auth);
    return true;
}

export function captureUnknownNativeAuth(db: Database, providerID: string, auth: AuthInfo) {
    if (saveKnownNativeAuth(db, providerID, auth)) return false;
    createPendingConnection(db, providerID, auth, "auth-file");
    return true;
}

function initialAuthSnapshot(db: Database, authByProvider: Record<string, AuthInfo>) {
    const snapshot: Record<string, AuthInfo> = {};
    for (const [providerID, auth] of Object.entries(authByProvider)) {
        if (listAccounts(db, providerID).some((account) => sameSavedAuth(account.auth, auth))) {
            snapshot[providerID] = auth;
        }
    }
    return snapshot;
}

function createAuthWatcher(options: AuthWatcherOptions) {
    let lastAuthSnapshot = options.initialSnapshot ?? {};
    let inFlight = false;
    const notify = options.showToast ?? defaultShowToast;
    const createPending = options.createPending ?? createPendingConnection;
    const isSuppressed = options.isSuppressed ?? ((providerID: string) => {
        return isNativeAuthCaptureSuppressed(providerID) || isDbNativeAuthCaptureSuppressed(options.db, providerID);
    });

    return {
        async poll() {
            if (inFlight) return;
            inFlight = true;
            try {
                const result = options.readAuth();
                if (!result.ok) return;

                const next = result.auth;
                const changed: Array<[string, AuthInfo]> = [];
                for (const [providerID, auth] of Object.entries(next)) {
                    if (isSuppressed(providerID)) {
                        const active = getActiveAccount(options.db, providerID);
                        if (active && sameSavedAuth(active.auth, auth)) updateAccountAuth(options.db, providerID, active.alias, auth);
                        lastAuthSnapshot[providerID] = auth;
                        continue;
                    }
                    if (saveKnownNativeAuth(options.db, providerID, auth)) {
                        lastAuthSnapshot[providerID] = auth;
                        continue;
                    }
                    if (!authChanged(lastAuthSnapshot[providerID], auth)) continue;
                    changed.push([providerID, auth]);
                }

                for (const [providerID, auth] of changed) {
                    createPending(options.db, providerID, auth, "auth-file");
                    lastAuthSnapshot[providerID] = auth;
                    await notify(
                        options.client,
                        `Balancer detected a ${providerID} connection. Save an alias from the TUI sidebar.`,
                        "info",
                    );
                }

                for (const providerID of Object.keys(lastAuthSnapshot)) {
                    if (!(providerID in next)) delete lastAuthSnapshot[providerID];
                }
            } finally {
                inFlight = false;
            }
        },
    };
}

export function startAuthWatcher(client: any, db: Database) {
    if (started) return;
    started = true;
    const initial = readNativeAuth();
    const watcher = createAuthWatcher({
        db,
        client,
        initialSnapshot: initial.ok ? initialAuthSnapshot(db, initial.auth) : {},
        readAuth: readNativeAuth,
    });

    const timer = setInterval(() => void watcher.poll(), 1_000);
    (timer as { unref?: () => void }).unref?.();
}

export const __testParseNativeAuthContent = parseNativeAuthContent;

export const __testInitialAuthSnapshot = initialAuthSnapshot;

export function __testCreateAuthWatcher(
    options: Omit<AuthWatcherOptions, "client"> & { client?: any },
) {
    return createAuthWatcher({ ...options, client: options.client ?? {} });
}
