import {
	getAccount,
	getActiveAccount,
	getSelectedAccount,
	removeAccount,
	renameAccount,
	setActiveAccount,
} from "../core/accounts";
import { appendEvent } from "../core/events";
import { suppressNativeAuthCapture } from "../core/native-auth-suppression";
import {
	completePendingConnection,
	removePendingConnection,
} from "../core/pending";
import { refreshAccountUsage } from "../core/usage";
import { saveUsageSnapshot } from "../core/usage/store";
import { forceTuiRefresh } from "./db-cache";
import type { BalancerTuiState } from "./state";

type AuthSetApi = {
	client: {
		auth: {
			set: (input: any) => unknown;
		};
	};
	keymap?: {
		dispatchCommand?: (command: string) => unknown;
	};
	ui?: {
		toast: (input: {
			variant: "success" | "warning" | "error" | "info";
			message: string;
		}) => unknown;
	};
};

type ActivateAccountOptions = {
	sessionProviderID?: string;
	applyNativeProviderModel?: (providerID: string) => Promise<boolean>;
};

type ToastApi = {
	ui: {
		toast: (input: {
			variant: "success" | "warning" | "error" | "info";
			message: string;
		}) => unknown;
	};
};

type RefreshUsageOptions = {
	refreshUsage?: typeof refreshAccountUsage;
	silent?: boolean;
};

export function savePendingAlias(
	state: BalancerTuiState,
	pendingID: string,
	alias: string,
) {
	const account = completePendingConnection(state.db, pendingID, alias);
	state.refresh();
	return account;
}

export async function activateAccount(
	api: AuthSetApi,
	state: BalancerTuiState,
	providerID: string,
	alias: string,
	options: ActivateAccountOptions = {},
) {
	const previousProviderID = getSelectedAccount(state.db)?.providerID;
	const account =
		setActiveAccount(state.db, providerID, alias) ??
		getActiveAccount(state.db, providerID);

	if (account) {
		try {
			suppressNativeAuthCapture(state.db, providerID);
			await api.client.auth.set({
				body: account.auth,
				path: { id: providerID },
			});
		} catch {}
	}

	state.refresh();
	const providerChanged =
		(options.sessionProviderID ?? previousProviderID) !== providerID;
	if (providerChanged) {
		await options.applyNativeProviderModel?.(providerID);
	}
	api.ui?.toast({
		message: `Activated ${providerID}/${alias}.`,
		variant: "success",
	});
}

export async function refreshUsageForAccount(
	api: ToastApi,
	state: BalancerTuiState,
	providerID: string,
	alias: string,
	options: RefreshUsageOptions = {},
) {
	const account =
		state.accounts().find((candidate) => {
			return candidate.providerID === providerID && candidate.alias === alias;
		}) ?? getAccount(state.db, providerID, alias);

	if (!account) {
		api.ui.toast({
			message: `Account not found: ${providerID}/${alias}`,
			variant: "error",
		});
		return;
	}

	try {
		const snapshot = await (options.refreshUsage ?? refreshAccountUsage)(
			account,
		);
		saveUsageSnapshot(state.db, snapshot);
		appendEvent(state.db, {
			alias,
			message: snapshot.message,
			providerID,
			type:
				snapshot.confidence === "unavailable"
					? "usage_unavailable"
					: "usage_refreshed",
		});
		if (options.silent) {
			// Background auto-refresh: several accounts' usage checks can
			// resolve within milliseconds of each other, so calling the
			// heavy synchronous state.refresh() (which rebuilds the whole
			// snapshot, including resolveActiveSelection for every
			// provider) here could fire a burst of main-thread stalls
			// completely independent of anything the person is doing.
			// forceTuiRefresh() just nudges the worker to recompute and
			// push the update off the main thread instead.
			forceTuiRefresh();
		} else {
			state.refresh();
			api.ui.toast({
				message: snapshot.message,
				variant: snapshot.confidence === "unavailable" ? "warning" : "success",
			});
		}
	} catch (error) {
		const message =
			error instanceof Error ? error.message : "Usage refresh failed.";
		api.ui.toast({ message, variant: "error" });
	}
}

export function removeAccountFromTui(
	api: ToastApi,
	state: BalancerTuiState,
	providerID: string,
	alias: string,
) {
	const removed = removeAccount(state.db, providerID, alias);
	if (!removed) {
		api.ui.toast({
			message: `Account not found: ${providerID}/${alias}`,
			variant: "error",
		});
		return;
	}

	const message = `Removed account ${providerID}/${alias}.`;
	appendEvent(state.db, {
		alias,
		message,
		providerID,
		type: "account_removed",
	});
	state.refresh();
	state.removeAccountView(providerID, alias);
	api.ui.toast({ message, variant: "success" });
}

export function renameAccountFromTui(
	api: ToastApi,
	state: BalancerTuiState,
	providerID: string,
	alias: string,
	nextAlias: string,
) {
	const account = renameAccount(state.db, providerID, alias, nextAlias);
	state.refresh();
	api.ui.toast({
		message: `Renamed ${providerID}/${alias} to ${account.alias}.`,
		variant: "success",
	});
	return account;
}

export function removePendingFromTui(
	api: ToastApi,
	state: BalancerTuiState,
	pendingID: string,
) {
	const removed = removePendingConnection(state.db, pendingID);
	if (!removed) {
		api.ui.toast({
			message: "Pending connection not found.",
			variant: "error",
		});
		return;
	}

	state.refresh();
	state.removePendingView(pendingID);
	api.ui.toast({ message: "Removed pending connection.", variant: "success" });
}
