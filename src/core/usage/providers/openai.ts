import type { Account } from "../../types";
import { redactUsageError, redactUsagePayload } from "../redact";
import type { ProviderUsageService, ProviderUsageSnapshot } from "../types";

function unavailable(
	account: Account,
	message: string,
	error?: string,
): ProviderUsageSnapshot {
	return {
		alias: account.alias,
		confidence: "unavailable",
		fetchedAt: Date.now(),
		message,
		providerID: account.providerID,
		...(error ? { error: redactUsageError(error, account) } : {}),
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value)
		? value
		: undefined;
}

function decodeJwtPayload(token: string): Record<string, unknown> | undefined {
	const payload = token.split(".")[1];
	if (!payload) return undefined;

	try {
		const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
		const padded = `${normalized}${"=".repeat((4 - (normalized.length % 4)) % 4)}`;
		const decoded = JSON.parse(
			Buffer.from(padded, "base64").toString("utf8"),
		) as unknown;
		return isRecord(decoded) ? decoded : undefined;
	} catch {
		return undefined;
	}
}

function chatgptAccountID(account: Account): string | undefined {
	if (account.auth.type !== "oauth") return undefined;
	if (account.auth.accountId) return account.auth.accountId;

	const payload = decodeJwtPayload(account.auth.access);
	const authClaim = payload?.["https://api.openai.com/auth"];
	if (!isRecord(authClaim)) return undefined;

	const accountID = authClaim.chatgpt_account_id;
	return typeof accountID === "string" && accountID.trim()
		? accountID
		: undefined;
}

function planName(planType: unknown): string | undefined {
	if (typeof planType !== "string" || !planType.trim()) return undefined;
	const normalized = planType.trim().toLowerCase();
	const names: Record<string, string> = {
		enterprise: "ChatGPT Enterprise",
		plus: "ChatGPT Plus",
		pro: "ChatGPT Pro",
		team: "ChatGPT Team",
	};
	return names[normalized] ?? planType;
}

function resetAtMillis(value: unknown): number | undefined {
	const timestamp = asNumber(value);
	if (timestamp === undefined || timestamp < 0) return undefined;
	return timestamp > 1_000_000_000_000 ? timestamp : timestamp * 1000;
}

async function refreshChatGPTUsage(
	account: Account,
): Promise<ProviderUsageSnapshot> {
	if (account.auth.type !== "oauth") {
		return unavailable(account, "OpenAI ChatGPT usage requires OAuth auth.");
	}

	try {
		const headers: Record<string, string> = {
			Authorization: `Bearer ${account.auth.access}`,
			"User-Agent": "opencode-balancer/0.1.3",
		};
		const accountID = chatgptAccountID(account);
		if (accountID) headers["ChatGPT-Account-Id"] = accountID;

		const response = await fetch("https://chatgpt.com/backend-api/wham/usage", {
			headers,
		});
		if (!response.ok) {
			return unavailable(
				account,
				`OpenAI ChatGPT usage request failed with HTTP ${response.status}.`,
			);
		}

		const body = (await response.json()) as unknown;
		const rateLimit =
			isRecord(body) && isRecord(body.rate_limit) ? body.rate_limit : undefined;
		const primary =
			rateLimit && isRecord(rateLimit.primary_window)
				? rateLimit.primary_window
				: undefined;
		return {
			alias: account.alias,
			confidence: "exact",
			fetchedAt: Date.now(),
			message: "OpenAI ChatGPT usage fetched.",
			planName: isRecord(body) ? planName(body.plan_type) : undefined,
			providerID: account.providerID,
			rawRedacted: redactUsagePayload(body, account),
			resetAt: primary ? resetAtMillis(primary.reset_at) : undefined,
			usedPercent: primary ? asNumber(primary.used_percent) : undefined,
		};
	} catch (error) {
		return unavailable(
			account,
			"OpenAI ChatGPT usage request failed; exact usage is unavailable.",
			error instanceof Error ? error.message : String(error),
		);
	}
}

export const openaiUsageService: ProviderUsageService = {
	providerID: "openai",
	async refreshUsage(account) {
		if (account.auth.type !== "api") {
			return refreshChatGPTUsage(account);
		}

		const url = new URL(
			"https://api.openai.com/v1/organization/usage/completions",
		);
		url.searchParams.set(
			"start_time",
			String(Math.floor((Date.now() - 24 * 60 * 60 * 1000) / 1000)),
		);
		url.searchParams.set("bucket_width", "1d");

		try {
			const response = await fetch(url, {
				headers: {
					Authorization: `Bearer ${account.auth.key}`,
				},
			});
			if (!response.ok) {
				return unavailable(
					account,
					`OpenAI usage request failed with HTTP ${response.status}.`,
				);
			}

			const body = await response.json();
			return {
				alias: account.alias,
				confidence: "exact",
				fetchedAt: Date.now(),
				message: "OpenAI organization usage fetched.",
				providerID: account.providerID,
				rawRedacted: redactUsagePayload(body, account),
			};
		} catch (error) {
			return unavailable(
				account,
				"OpenAI usage request failed; exact usage is unavailable.",
				error instanceof Error ? error.message : String(error),
			);
		}
	},
	supports(providerID) {
		return providerID === "openai";
	},
};
