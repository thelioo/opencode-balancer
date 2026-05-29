import { now } from "./state";
import type { AuthInfo, Store } from "./types";

function joinPath(...parts: string[]) {
    return parts
        .filter(Boolean)
        .join("/")
        .replace(/\/+/g, "/");
}

function homeDir() {
    return Bun.env.HOME || "/";
}

function xdgConfigHome() {
    return Bun.env.XDG_CONFIG_HOME || joinPath(homeDir(), ".config");
}

function xdgDataHome() {
    return Bun.env.XDG_DATA_HOME || joinPath(homeDir(), ".local", "share");
}

function configDir() {
    return Bun.env.OPENCODE_CONFIG_DIR || joinPath(xdgConfigHome(), "opencode");
}

function dataDir() {
    return joinPath(xdgDataHome(), "opencode");
}

export function storePath() {
    return joinPath(configDir(), "balancer-accounts.json");
}

export function authPath() {
    return joinPath(dataDir(), "auth.json");
}

function emptyStore(): Store {
    return { version: 1, providers: {} };
}

async function readJsonFile<T>(path: string, fallback: T): Promise<T> {
    try {
        const file = Bun.file(path);
        if (!(await file.exists())) return fallback;
        return JSON.parse(await file.text()) as T;
    } catch {
        return fallback;
    }
}

async function writeJsonFile(path: string, value: unknown) {
    await Bun.write(path, `${JSON.stringify(value, null, 2)}\n`, {
        mode: 0o600,
    } as any);
}

export async function readStore(): Promise<Store> {
    const parsed = await readJsonFile<Store>(storePath(), emptyStore());
    if (parsed.version !== 1 || !parsed.providers) return emptyStore();
    return parsed;
}

export async function writeStore(store: Store) {
    await writeJsonFile(storePath(), store);
}

export async function readNativeAuth(): Promise<Record<string, AuthInfo>> {
    if (Bun.env.OPENCODE_AUTH_CONTENT) {
        try {
            return JSON.parse(Bun.env.OPENCODE_AUTH_CONTENT) as Record<
                string,
                AuthInfo
            >;
        } catch {
            return {};
        }
    }
    return readJsonFile<Record<string, AuthInfo>>(authPath(), {});
}

export function isAuthInfo(value: unknown): value is AuthInfo {
    if (!value || typeof value !== "object") return false;
    const type = (value as { type?: unknown }).type;
    if (type === "api")
        return typeof (value as { key?: unknown }).key === "string";
    if (type === "oauth") {
        const item = value as {
            refresh?: unknown;
            access?: unknown;
            expires?: unknown;
        };
        return (
            typeof item.refresh === "string" &&
            typeof item.access === "string" &&
            typeof item.expires === "number"
        );
    }
    if (type === "wellknown") {
        const item = value as { key?: unknown; token?: unknown };
        return typeof item.key === "string" && typeof item.token === "string";
    }
    return false;
}

export async function captureAuth(
    providerID: string,
    auth: AuthInfo,
    source: NonNullable<Store["lastCaptured"]>["source"],
): Promise<Store> {
    const store = await readStore();
    store.lastCaptured = { providerID, auth, capturedAt: now(), source };
    await writeStore(store);
    return store;
}
