import { now } from "./state";
import { readStore, writeStore } from "./storage";
import type { Account, AuthInfo, ProviderState } from "./types";

export function normalizeAlias(alias: string) {
    return alias
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, "-")
        .replace(/^-+|-+$/g, "");
}

export async function saveAccount(
    providerID: string,
    aliasInput: string,
    auth: AuthInfo,
): Promise<Account> {
    const alias = normalizeAlias(aliasInput);
    if (!alias)
        throw new Error(
            "Invalid alias. Use letters, numbers, dots, hyphens, or underscores.",
        );

    const store = await readStore();
    const provider = store.providers[providerID] ?? { accounts: {} };
    const existing = provider.accounts[alias];
    const account: Account = {
        alias,
        providerID,
        auth,
        createdAt: existing?.createdAt ?? now(),
        updatedAt: now(),
        lastUsedAt: existing?.lastUsedAt,
        failures: existing?.failures,
        rateLimitedUntil: existing?.rateLimitedUntil,
    };
    provider.accounts[alias] = account;
    provider.active = alias;
    store.providers[providerID] = provider;
    store.lastCaptured = {
        providerID,
        auth,
        capturedAt: now(),
        source: store.lastCaptured?.source ?? "auth-file",
    };
    await writeStore(store);
    return account;
}

export async function getProviderState(
    providerID: string,
): Promise<ProviderState | undefined> {
    return (await readStore()).providers[providerID];
}

export async function getActiveAccount(
    providerID: string,
): Promise<Account | undefined> {
    const provider = await getProviderState(providerID);
    if (!provider?.active) return undefined;
    return provider.accounts[provider.active];
}

export async function listAccountsText() {
    const store = await readStore();
    const lines: string[] = [];
    for (const [providerID, provider] of Object.entries(store.providers).sort(
        ([a], [b]) => a.localeCompare(b),
    )) {
        lines.push(`${providerID}:`);
        const accounts: Account[] = Object.values(provider.accounts).sort(
            (a, b) => a.alias.localeCompare(b.alias),
        );
        if (accounts.length === 0) {
            lines.push("  (no accounts)");
            continue;
        }
        for (const account of accounts) {
            const marker = provider.active === account.alias ? "*" : " ";
            const limited =
                account.rateLimitedUntil && account.rateLimitedUntil > now()
                    ? ` rate-limited ${Math.ceil((account.rateLimitedUntil - now()) / 1000)}s`
                    : "healthy";
            lines.push(
                `  ${marker} ${account.alias} (${account.auth.type}, ${limited})`,
            );
        }
    }
    if (lines.length === 0)
        return "No accounts saved. Use `/connect <provider>` and then `/balancer alias <name>`.";
    const last = store.lastCaptured;
    if (last)
        lines.push(
            "",
            `Last detected connection: ${last.providerID} (${last.auth.type})`,
        );
    return lines.join("\n");
}

export async function nextAvailableAccount(
    providerID: string,
    currentAlias?: string,
): Promise<Account | undefined> {
    const provider = await getProviderState(providerID);
    if (!provider) return undefined;
    const accounts: Account[] = Object.values(provider.accounts);
    return accounts.find(
        (account) =>
            account.alias !== currentAlias &&
            (!account.rateLimitedUntil || account.rateLimitedUntil <= now()),
    );
}

export async function markRateLimited(
    providerID: string,
    alias: string,
    retryAfterMs = 60_000,
) {
    const store = await readStore();
    const account = store.providers[providerID]?.accounts[alias];
    if (!account) return;
    account.failures = (account.failures ?? 0) + 1;
    account.rateLimitedUntil = now() + retryAfterMs;
    account.updatedAt = now();
    await writeStore(store);
}

export async function markUsed(providerID: string, alias: string) {
    const store = await readStore();
    const account = store.providers[providerID]?.accounts[alias];
    if (!account) return;
    account.lastUsedAt = now();
    account.updatedAt = now();
    if (account.rateLimitedUntil && account.rateLimitedUntil <= now())
        delete account.rateLimitedUntil;
    await writeStore(store);
}
