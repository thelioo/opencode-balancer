import type { refreshAccountUsage } from "../core/usage";
import { refreshUsageForAccount } from "./actions";
import type { BalancerTuiState } from "./state";

type ToastApi = Parameters<typeof refreshUsageForAccount>[0];

type UsageAutoRefreshOptions = {
	intervalMs?: number;
	promptDebounceMs?: number;
	refreshUsage?: typeof refreshAccountUsage;
	now?: () => number;
};

export function createUsageAutoRefresh(
	api: ToastApi,
	state: BalancerTuiState,
	options: UsageAutoRefreshOptions = {},
) {
	const intervalMs = options.intervalMs ?? 60_000;
	const promptDebounceMs = options.promptDebounceMs ?? 30_000;
	const now = options.now ?? Date.now;
	const inFlight = new Set<string>();
	let lastPromptRefreshAt = 0;

	const refreshOne = async (providerID: string, alias: string) => {
		const key = `${providerID}/${alias}`;
		if (inFlight.has(key)) return;

		inFlight.add(key);
		try {
			await refreshUsageForAccount(api, state, providerID, alias, {
				refreshUsage: options.refreshUsage,
				silent: true,
			});
		} finally {
			inFlight.delete(key);
		}
	};

	const refreshNow = async () => {
		const accounts = state.accounts().filter((account) => !account.disabled);
		await Promise.all(
			accounts.map((account) => refreshOne(account.providerID, account.alias)),
		);
	};

	const refreshForPrompt = async () => {
		const current = now();
		if (current - lastPromptRefreshAt < promptDebounceMs) return;

		lastPromptRefreshAt = current;
		await refreshNow();
	};

	const timer =
		intervalMs > 0
			? setInterval(() => void refreshNow(), intervalMs)
			: undefined;
	void refreshNow();

	return {
		dispose() {
			if (timer) clearInterval(timer);
		},
		refreshForPrompt,
		refreshNow,
	};
}
