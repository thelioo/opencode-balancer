import type { Account } from "../types";
import type { ProviderUsageSnapshot } from "./types";
import { copilotUsageService } from "./providers/copilot";
import { openaiUsageService } from "./providers/openai";

export const usageServices = [openaiUsageService, copilotUsageService];

export async function refreshAccountUsage(
    account: Account,
): Promise<ProviderUsageSnapshot> {
    const service = usageServices.find((candidate) =>
        candidate.supports(account.providerID),
    );
    if (service) return service.refreshUsage(account);

    return {
        providerID: account.providerID,
        alias: account.alias,
        fetchedAt: Date.now(),
        confidence: "unavailable",
        message: `No usage service registered for ${account.providerID}.`,
    };
}
