import type { Account } from "../types";

export type UsageConfidence = "exact" | "estimated" | "unavailable";

export type ProviderUsageSnapshot = {
	providerID: string;
	alias: string;
	fetchedAt: number;
	confidence: UsageConfidence;
	planName?: string;
	usedTokens?: number;
	remainingTokens?: number;
	usedPercent?: number;
	resetAt?: number;
	message: string;
	rawRedacted?: unknown;
	error?: string;
};

export type ProviderUsageService = {
	providerID: string;
	supports(providerID: string): boolean;
	refreshUsage(account: Account): Promise<ProviderUsageSnapshot>;
};
