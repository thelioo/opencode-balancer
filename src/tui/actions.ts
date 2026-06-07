import { getAccount, getActiveAccount, getSelectedAccount, removeAccount, renameAccount, setActiveAccount } from "../core/accounts";
import { appendEvent } from "../core/events";
import { completePendingConnection, removePendingConnection } from "../core/pending";
import { refreshAccountUsage } from "../core/usage";
import { saveUsageSnapshot } from "../core/usage/store";
import { suppressNativeAuthCapture } from "../core/native-auth-suppression";
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
        toast: (input: { variant: "success" | "warning" | "error" | "info"; message: string }) => unknown;
    };
};

type ActivateAccountOptions = {
    sessionProviderID?: string;
    applyNativeProviderModel?: (providerID: string) => Promise<boolean>;
};

type ToastApi = {
    ui: {
        toast: (input: { variant: "success" | "warning" | "error" | "info"; message: string }) => unknown;
    };
};

type RefreshUsageOptions = {
    refreshUsage?: typeof refreshAccountUsage;
    silent?: boolean;
};

export function savePendingAlias(state: BalancerTuiState, pendingID: string, alias: string) {
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
    const account = setActiveAccount(state.db, providerID, alias) ?? getActiveAccount(state.db, providerID);

    if (account) {
        try {
            suppressNativeAuthCapture(state.db, providerID);
            await api.client.auth.set({ path: { id: providerID }, body: account.auth });
        } catch {}
    }

    state.refresh();
    const providerChanged = (options.sessionProviderID ?? previousProviderID) !== providerID;
    if (providerChanged) {
        await options.applyNativeProviderModel?.(providerID);
    }
    api.ui?.toast({ variant: "success", message: `Activated ${providerID}/${alias}.` });
}

export async function refreshUsageForAccount(
    api: ToastApi,
    state: BalancerTuiState,
    providerID: string,
    alias: string,
    options: RefreshUsageOptions = {},
) {
    const account = getAccount(state.db, providerID, alias) ?? state.accounts().find((candidate) => {
        return candidate.providerID === providerID && candidate.alias === alias;
    });

    if (!account) {
        api.ui.toast({ variant: "error", message: `Account not found: ${providerID}/${alias}` });
        return;
    }

    try {
        const snapshot = await (options.refreshUsage ?? refreshAccountUsage)(account);
        saveUsageSnapshot(state.db, snapshot);
        appendEvent(state.db, {
            type: snapshot.confidence === "unavailable" ? "usage_unavailable" : "usage_refreshed",
            providerID,
            alias,
            message: snapshot.message,
        });
        state.refresh();
        if (!options.silent) {
            api.ui.toast({
                variant: snapshot.confidence === "unavailable" ? "warning" : "success",
                message: snapshot.message,
            });
        }
    } catch (error) {
        const message = error instanceof Error ? error.message : "Usage refresh failed.";
        api.ui.toast({ variant: "error", message });
    }
}

export function removeAccountFromTui(api: ToastApi, state: BalancerTuiState, providerID: string, alias: string) {
    const removed = removeAccount(state.db, providerID, alias);
    if (!removed) {
        api.ui.toast({ variant: "error", message: `Account not found: ${providerID}/${alias}` });
        return;
    }

    const message = `Removed account ${providerID}/${alias}.`;
    appendEvent(state.db, {
        type: "account_removed",
        providerID,
        alias,
        message,
    });
    state.refresh();
    state.removeAccountView(providerID, alias);
    api.ui.toast({ variant: "success", message });
}

export function renameAccountFromTui(api: ToastApi, state: BalancerTuiState, providerID: string, alias: string, nextAlias: string) {
    const account = renameAccount(state.db, providerID, alias, nextAlias);
    state.refresh();
    api.ui.toast({ variant: "success", message: `Renamed ${providerID}/${alias} to ${account.alias}.` });
    return account;
}

export function removePendingFromTui(api: ToastApi, state: BalancerTuiState, pendingID: string) {
    const removed = removePendingConnection(state.db, pendingID);
    if (!removed) {
        api.ui.toast({ variant: "error", message: "Pending connection not found." });
        return;
    }

    state.refresh();
    state.removePendingView(pendingID);
    api.ui.toast({ variant: "success", message: "Removed pending connection." });
}
