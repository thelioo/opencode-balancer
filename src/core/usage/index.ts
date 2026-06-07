import type { Account } from "../types";
import { copilotUsageService } from "./providers/copilot";
import { openaiUsageService } from "./providers/openai";
import type { ProviderUsageSnapshot } from "./types";

export const usageServices = [openaiUsageService, copilotUsageService];

export async function refreshAccountUsage(
	account: Account,
): Promise<ProviderUsageSnapshot> {
	const service = usageServices.find((candidate) =>
		candidate.supports(account.providerID),
	);
	if (service) return service.refreshUsage(account);

	return {
		alias: account.alias,
		confidence: "unavailable",
		fetchedAt: Date.now(),
		message: `No usage service registered for ${account.providerID}.`,
		providerID: account.providerID,
	};
}
