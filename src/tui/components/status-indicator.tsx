/** @jsxImportSource @opentui/solid */

import type { TuiPluginApi } from "@opencode-ai/plugin/tui";
import { createSignal, onCleanup } from "solid-js";
import { getActiveAccount, getSelectedAccount } from "../../core/accounts";
import { getBalancingEnabled, resolveActiveSelection, type ActiveSelection } from "../../core/priority";
import type { Account } from "../../core/types";
import { getUsageSnapshot } from "../../core/usage/store";
import { formatBalancerStatus } from "../status-format";
import type { BalancerTuiState } from "../state";
import { formatUsageBar } from "../usage-format";
import { snapshotPercent } from "./usage-display";

export type BalancerStatusIndicatorProps = {
    api: TuiPluginApi;
    state: BalancerTuiState;
    providerID?: string | (() => string | undefined);
};

export function BalancerStatusIndicator(props: BalancerStatusIndicatorProps) {
    const [selected, setSelected] = createSignal<Account | undefined>();
    const [sessionActive, setSessionActive] = createSignal<Account | undefined>();
    const [balancing, setBalancing] = createSignal<ActiveSelection | undefined>();
    const [usage, setUsage] = createSignal<string | undefined>();
    const providerID = () => (typeof props.providerID === "function" ? props.providerID() : props.providerID);
    const refresh = () => {
        const currentProviderID = providerID();
        const nextSelected = getSelectedAccount(props.state.db);
        const nextSessionActive = currentProviderID ? getActiveAccount(props.state.db, currentProviderID) : undefined;
        const nextBalancing = getBalancingEnabled(props.state.db)
            ? resolveActiveSelection(props.state.db, undefined, currentProviderID)
            : undefined;
        const usageAccount = nextBalancing?.account ?? nextSelected ?? nextSessionActive;
        setSelected(nextSelected);
        setSessionActive(nextSessionActive);
        setBalancing(nextBalancing);
        setUsage(
            usageAccount
                ? formatUsageBar(
                      snapshotPercent(getUsageSnapshot(props.state.db, usageAccount.providerID, usageAccount.alias)),
                      4,
                  )
                : undefined,
        );
    };
    refresh();
    const timer = setInterval(refresh, 500);
    onCleanup(() => clearInterval(timer));

    const status = () => {
        return formatBalancerStatus({
            selected: selected(),
            sessionActive: sessionActive(),
            sessionProviderID: providerID(),
            balancing: balancing()
                ? {
                      providerID: balancing()!.providerID,
                      alias: balancing()!.account.alias,
                      modelID: balancing()!.modelID,
                  }
                : undefined,
            usage: usage(),
        });
    };

    const color = () => {
        if (balancing()) return props.api.theme.current.success;
        if (providerID()) return sessionActive() ? props.api.theme.current.success : props.api.theme.current.textMuted;
        if (!selected()) return props.api.theme.current.textMuted;
        return props.api.theme.current.success;
    };

    return (
        <text fg={color()} wrapMode="none" truncate>
            {status()}
        </text>
    );
}
