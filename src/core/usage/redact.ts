import type { Account } from "../types";

const REDACTED = "[redacted]";

function accountSecretValues(account: Account) {
    const values = new Set<string>();
    if (account.auth.type === "api") values.add(account.auth.key);
    if (account.auth.type === "oauth") {
        values.add(account.auth.access);
        values.add(account.auth.refresh);
    }
    if (account.auth.type === "wellknown") {
        values.add(account.auth.key);
        values.add(account.auth.token);
    }
    values.delete("");
    return values;
}

function keyWords(key: string) {
    return key
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter(Boolean);
}

function isCredentialKey(key: string) {
    const lower = key.toLowerCase();
    const compact = lower.replace(/[^a-z0-9]/g, "");
    if (
        lower.includes("api_key") ||
        compact.includes("apikey") ||
        lower.includes("access_token") ||
        compact.includes("accesstoken") ||
        lower.includes("refresh_token") ||
        compact.includes("refreshtoken") ||
        lower.includes("x-api-key") ||
        compact.includes("xapikey") ||
        lower.includes("authorization")
    ) {
        return true;
    }

    const words = keyWords(key);
    return ["token", "key", "secret", "password"].some((credential) =>
        lower === credential || words.includes(credential),
    );
}

export function redactUsagePayload(value: unknown, account: Account): unknown {
    return redactValue(value, accountSecretValues(account));
}

export function redactUsageError(error: string, account: Account) {
    return redactString(error, accountSecretValues(account));
}

function redactString(value: string, secrets: Set<string>) {
    let redacted = value;
    for (const secret of [...secrets].sort((a, b) => b.length - a.length)) {
        redacted = redacted.split(secret).join(REDACTED);
    }
    return redacted;
}

function redactValue(value: unknown, secrets: Set<string>): unknown {
    if (typeof value === "string") return redactString(value, secrets);
    if (!value || typeof value !== "object") return value;
    if (Array.isArray(value)) return value.map((item) => redactValue(item, secrets));

    const redacted: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
        redacted[redactString(key, secrets)] = isCredentialKey(key) ? REDACTED : redactValue(child, secrets);
    }
    return redacted;
}
