import type { Account } from "../../types";
import { redactUsageError, redactUsagePayload } from "../redact";
import type { ProviderUsageService, ProviderUsageSnapshot } from "../types";

function unavailable(account: Account, message: string, error?: string): ProviderUsageSnapshot {
    return {
        providerID: account.providerID,
        alias: account.alias,
        fetchedAt: Date.now(),
        confidence: "unavailable",
        message,
        ...(error ? { error: redactUsageError(error, account) } : {}),
    };
}

function githubHeaders(account: Account) {
    return {
        Authorization: `Bearer ${account.auth.type === "oauth" ? account.auth.access : ""}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2026-03-10",
    };
}

async function fetchJSON(url: string, account: Account) {
    const response = await fetch(url, { headers: githubHeaders(account) });
    if (!response.ok) return { ok: false as const, status: response.status };
    try {
        return { ok: true as const, body: await response.json() };
    } catch {
        return { ok: true as const, body: undefined };
    }
}

function sumNetQuantity(body: unknown) {
    const items = (body as { usageItems?: unknown } | undefined)?.usageItems;
    if (!Array.isArray(items)) return undefined;

    let total = 0;
    let found = false;
    for (const item of items) {
        const quantity = (item as { netQuantity?: unknown; quantity?: unknown } | undefined)?.netQuantity;
        const legacyQuantity = (item as { quantity?: unknown } | undefined)?.quantity;
        const value = typeof quantity === "number" ? quantity : typeof legacyQuantity === "number" ? legacyQuantity : undefined;
        if (value === undefined) continue;
        total += value;
        found = true;
    }
    return found ? total : undefined;
}

function numberAt(value: unknown, path: string[]) {
    let current = value;
    for (const key of path) current = (current as Record<string, unknown> | undefined)?.[key];
    return typeof current === "number" && Number.isFinite(current) ? current : undefined;
}

function parseInternalQuota(body: unknown) {
    const premium = (body as { quota_snapshots?: { premium_interactions?: unknown; premium_models?: unknown; chat?: unknown } })
        ?.quota_snapshots;
    const snapshot = premium?.premium_interactions ?? premium?.premium_models ?? premium?.chat;
    const entitlement = numberAt(snapshot, ["entitlement"]);
    const remaining = numberAt(snapshot, ["remaining"]) ?? numberAt(snapshot, ["quota_remaining"]);
    const percentRemaining = numberAt(snapshot, ["percent_remaining"]);

    return {
        entitlement,
        remaining,
        used: entitlement !== undefined && remaining !== undefined ? Math.max(0, entitlement - remaining) : undefined,
        percentRemaining,
    };
}

async function refreshInternalUserQuota(account: Account) {
    const internal = await fetchJSON("https://api.github.com/copilot_internal/user", account);
    if (!internal.ok) return { ok: false as const, status: internal.status };

    const login = typeof internal.body?.login === "string" ? internal.body.login : "GitHub user";
    const plan = typeof internal.body?.copilot_plan === "string" ? internal.body.copilot_plan : undefined;
    const quota = parseInternalQuota(internal.body);
    if (!plan && quota.used === undefined && quota.remaining === undefined) return { ok: false as const, status: 200 };
    return {
        ok: true as const,
        snapshot: {
            providerID: account.providerID,
            alias: account.alias,
            fetchedAt: Date.now(),
            confidence: "exact" as const,
            ...(quota.used !== undefined ? { usedTokens: quota.used } : {}),
            ...(quota.remaining !== undefined ? { remainingTokens: quota.remaining } : {}),
            message: plan
                ? `GitHub Copilot personal quota fetched for ${login} (${plan}).`
                : `GitHub Copilot personal quota fetched for ${login}.`,
            rawRedacted: redactUsagePayload(internal.body, account),
        },
    };
}

async function refreshPersonalUsage(account: Account): Promise<ProviderUsageSnapshot> {
    const internal = await refreshInternalUserQuota(account);
    if (internal.ok) return internal.snapshot;

    const user = await fetchJSON("https://api.github.com/user", account);
    if (!user.ok) {
        return unavailable(account, `GitHub Copilot personal billing usage requires user API access; /user returned HTTP ${user.status}.`);
    }

    const login = typeof user.body?.login === "string" ? user.body.login : undefined;
    if (!login) return unavailable(account, "GitHub Copilot personal billing usage requires a GitHub username from /user.");

    const premiumURL = `https://api.github.com/users/${encodeURIComponent(login)}/settings/billing/premium_request/usage`;
    const premium = await fetchJSON(premiumURL, account);
    if (premium.ok) {
        return {
            providerID: account.providerID,
            alias: account.alias,
            fetchedAt: Date.now(),
            confidence: "exact",
            usedTokens: sumNetQuantity(premium.body),
            message: `GitHub Copilot personal premium request usage fetched for ${login}.`,
            rawRedacted: redactUsagePayload(premium.body, account),
        };
    }

    const summaryURL = `https://api.github.com/users/${encodeURIComponent(login)}/settings/billing/usage/summary?product=copilot`;
    const summary = await fetchJSON(summaryURL, account);
    if (summary.ok) {
        return {
            providerID: account.providerID,
            alias: account.alias,
            fetchedAt: Date.now(),
            confidence: "exact",
            usedTokens: sumNetQuantity(summary.body),
            message: `GitHub Copilot personal billing usage fetched for ${login}.`,
            rawRedacted: redactUsagePayload(summary.body, account),
        };
    }

    return unavailable(
        account,
        `GitHub Copilot personal billing usage unavailable; copilot_internal/user returned HTTP ${internal.status}, premium requests returned HTTP ${premium.status}, and billing summary returned HTTP ${summary.status}.`,
    );
}

export const copilotUsageService: ProviderUsageService = {
    providerID: "github-copilot",
    supports(providerID) {
        return providerID === "github-copilot" || providerID === "copilot";
    },
    async refreshUsage(account) {
        const githubOrg = account.auth.metadata?.githubOrg;
        if (account.auth.type !== "oauth") {
            return unavailable(
                account,
                "GitHub Copilot usage requires OAuth auth.",
            );
        }

        if (!githubOrg) return refreshPersonalUsage(account);

        try {
            const response = await fetch(
                `https://api.github.com/orgs/${encodeURIComponent(githubOrg)}/copilot/billing`,
                {
                    headers: githubHeaders(account),
                },
            );
            if (!response.ok) {
                return unavailable(account, `GitHub Copilot billing request failed with HTTP ${response.status}.`);
            }

            const body = await response.json();
            const planName = typeof body?.plan_type === "string" ? body.plan_type : undefined;
            return {
                providerID: account.providerID,
                alias: account.alias,
                fetchedAt: Date.now(),
                confidence: "exact",
                ...(planName ? { planName } : {}),
                message: planName
                    ? `GitHub Copilot billing fetched for ${githubOrg} (${planName}).`
                    : `GitHub Copilot billing fetched for ${githubOrg}.`,
                rawRedacted: redactUsagePayload(body, account),
            };
        } catch (error) {
            return unavailable(
                account,
                "GitHub Copilot billing request failed; exact billing data is unavailable.",
                error instanceof Error ? error.message : String(error),
            );
        }
    },
};
