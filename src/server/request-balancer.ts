import type { Database } from "bun:sqlite";
import { getAccount, listAccounts, normalizeAlias } from "../core/accounts";
import { now } from "../core/time";
import type { Account } from "../core/types";

export const INTERNAL_REQUEST_HEADER = "x-opencode-balancer-request";
export const BALANCER_METADATA_KEY = "opencodeBalancerCommand";

export const RETRYABLE_STATUS = new Set([
	402, 403, 429, 500, 502, 503, 504, 529,
]);

// Some providers (notably opencode's own Zen free tier) signal quota/credit
// exhaustion with a status code that isn't in RETRYABLE_STATUS (e.g. plain
// 402/403, or sometimes even 200) and only distinguish it in the body text.
// These patterns let the fetch patch fall back to sniffing the body when the
// status code alone doesn't tell us the account is exhausted.
export const QUOTA_EXCEEDED_PATTERNS = [
	/free usage exceeded/i,
	/subscribe to go/i,
	/add credits/i,
	/insufficient_quota/i,
	/exceeded your current quota/i,
	/usage limit/i,
];

export function bodyLooksQuotaExceeded(text: string) {
	return QUOTA_EXCEEDED_PATTERNS.some((pattern) => pattern.test(text));
}

type PendingRequest = {
	providerID: string;
	account?: Account;
};

const pendingRequests = new Map<string, PendingRequest>();

export function setPendingRequest(requestID: string, request: PendingRequest) {
	pendingRequests.set(requestID, request);
}

export function takePendingRequest(requestID: string) {
	const request = pendingRequests.get(requestID);
	pendingRequests.delete(requestID);
	return request;
}

export function __testGetPendingRequest(requestID: string) {
	return pendingRequests.get(requestID);
}

export function __testClearPendingRequests() {
	pendingRequests.clear();
}

export function markRateLimited(
	db: Database,
	providerID: string,
	alias: string,
	retryAfterMs = 60_000,
) {
	const account = getAccount(db, providerID, alias);
	if (!account) return;

	const timestamp = now();
	db.query<unknown, [number, number, string, string]>(
		`UPDATE accounts
         SET failures = failures + 1,
             rate_limited_until = ?,
             updated_at = ?
         WHERE provider_id = ? AND alias = ?`,
	).run(timestamp + retryAfterMs, timestamp, providerID, account.alias);
}

export function chooseFailoverAccount(
	db: Database,
	providerID: string,
	currentAlias: string,
) {
	const timestamp = now();
	const normalizedCurrentAlias = normalizeAlias(currentAlias);
	return listAccounts(db, providerID).find((account) => {
		if (account.alias === normalizedCurrentAlias) return false;
		if (account.disabled) return false;
		return !account.rateLimitedUntil || account.rateLimitedUntil <= timestamp;
	});
}
