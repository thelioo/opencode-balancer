/** @jsxImportSource @opentui/solid */

import type { TuiPluginApi } from "@opencode-ai/plugin/tui";
import { createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { listAccounts } from "../../core/accounts";
import { getBalancingEnabled, setBalancingEnabled } from "../../core/priority";
import { getUsageSnapshot } from "../../core/usage/store";
import type { ProviderUsageSnapshot } from "../../core/usage/types";
import { dashboardSelectionMarker, moveDashboardFocus, reduceDashboardKey, type DashboardFocusArea } from "../dashboard-keys";
import { dashboardContentHeight, dashboardLayoutMode } from "../responsive";
import { selectedRowColors } from "../selection-colors";
import type { BalancerTuiState } from "../state";
import { UsageSnapshotBar } from "./usage-display";

type KeyLike = { name?: string };

type DashboardRow =
    | { type: "balancing"; key: string }
    | { type: "connect"; key: string }
    | { type: "account"; key: string; providerID: string; alias: string };

type HeaderAction = { type: "close" | "priority"; key: string; label: string };

export function Dashboard(props: {
    api: TuiPluginApi;
    state: BalancerTuiState;
    onBack: () => void;
    openPriority: () => void;
    openConnect: () => void;
    renameAccount: (providerID: string, alias: string) => void;
    removeAccount: (providerID: string, alias: string) => void;
}) {
    const theme = () => props.api.theme.current;
    const selectedColors = () => selectedRowColors(theme());
    const [confirmAccount, setConfirmAccount] = createSignal<string | undefined>();
    const [accounts, setAccounts] = createSignal(listAccounts(props.state.db));
    const [balancing, setBalancing] = createSignal(getBalancingEnabled(props.state.db));
    const [usage, setUsage] = createSignal<Record<string, ProviderUsageSnapshot | undefined>>({});
    const [cursor, setCursor] = createSignal(0);
    const [headerCursor, setHeaderCursor] = createSignal(0);
    const [focusArea, setFocusArea] = createSignal<DashboardFocusArea>("content");
    const layoutMode = () =>
        dashboardLayoutMode({
            width: (props.api.renderer as unknown as { width?: number }).width,
            height: (props.api.renderer as unknown as { height?: number }).height,
        });
    const compact = () => layoutMode() === "compact";
    const contentHeight = () =>
        dashboardContentHeight({ height: (props.api.renderer as unknown as { height?: number }).height });
    const headerActions: HeaderAction[] = [
        { type: "close", key: "close", label: "close" },
        { type: "priority", key: "priority", label: "priority" },
    ];
    const rows = createMemo<DashboardRow[]>(() => [
        { type: "balancing", key: "balancing" },
        { type: "connect", key: "connect" },
        ...accounts().map((account) => ({
            type: "account" as const,
            key: `account:${account.providerID}/${account.alias}`,
            providerID: account.providerID,
            alias: account.alias,
        })),
    ]);
    const clampCursor = (value: number) => Math.max(0, Math.min(value, Math.max(0, rows().length - 1)));
    const clampHeaderCursor = (value: number) => Math.max(0, Math.min(value, headerActions.length - 1));
    const refreshDashboard = () => {
        const nextAccounts = listAccounts(props.state.db);
        setAccounts(nextAccounts);
        setBalancing(getBalancingEnabled(props.state.db));
        setUsage(
            Object.fromEntries(
                nextAccounts.map((account) => [
                    `${account.providerID}/${account.alias}`,
                    getUsageSnapshot(props.state.db, account.providerID, account.alias),
                ]),
            ),
        );
        setCursor((value) => clampCursor(value));
    };
    refreshDashboard();
    const timer = setInterval(refreshDashboard, 500);
    onCleanup(() => clearInterval(timer));
    const Button = (buttonProps: { label: string; danger?: boolean; onClick: () => void }) => (
        <box onMouseUp={buttonProps.onClick} paddingLeft={0} paddingRight={0}>
            <text fg={buttonProps.danger ? theme().warning : theme().accent} wrapMode="none" truncate>
                [ {buttonProps.label} ]
            </text>
        </box>
    );

    const Chip = (chipProps: { keyName: string; label: string; danger?: boolean }) => (
        <text fg={chipProps.danger ? theme().warning : theme().accent} wrapMode="none">
            [{chipProps.keyName}] <span style={{ fg: theme().textMuted }}>{chipProps.label}</span>
        </text>
    );

    const SectionTitle = (sectionProps: { label: string; count?: number }) => (
        <box flexDirection="row" gap={1} height={1} flexShrink={0}>
            <text fg={theme().primary} wrapMode="none">
                {sectionProps.label}
            </text>
            <text fg={theme().textMuted} wrapMode="none">
                {sectionProps.count === undefined ? "" : `${sectionProps.count}`}
            </text>
        </box>
    );

    const Row = (rowProps: { selected?: boolean; onMouseUp?: () => void; children: unknown }) => (
        <box
            flexDirection="row"
            width="100%"
            minWidth={0}
            height={1}
            flexShrink={0}
            backgroundColor={rowProps.selected ? selectedColors().bg : undefined}
            onMouseUp={rowProps.onMouseUp}
        >
            {rowProps.children}
        </box>
    );

    const selected = (key: string) => focusArea() === "content" && rows()[cursor()]?.key === key;
    const headerSelected = (key: string) => focusArea() === "header" && headerActions[headerCursor()]?.key === key;
    const rowMarker = (key: string) =>
        dashboardSelectionMarker({
            focusedArea: focusArea(),
            itemArea: "content",
            selected: rows()[cursor()]?.key === key,
        });
    const headerMarker = (key: string) =>
        dashboardSelectionMarker({
            focusedArea: focusArea(),
            itemArea: "header",
            selected: headerActions[headerCursor()]?.key === key,
        });
    const current = () => rows()[cursor()];
    const currentHeader = () => headerActions[headerCursor()];
    const selectedLabel = () => {
        const row = current();
        if (focusArea() === "header") return currentHeader()?.type ?? "header";
        if (!row) return "none";
        if (row.type === "balancing") return "balancing";
        if (row.type === "connect") return "connect";
        if (row.type === "account") return `account/${row.providerID}/${row.alias}`;
        return "priority";
    };

    const selectedAction = () => {
        if (focusArea() === "header") {
            const action = currentHeader();
            return action?.type === "close" ? "Enter closes dashboard" : "Enter opens provider priority matrix";
        }
        const row = current();
        if (!row) return "Enter opens selected item";
        if (row.type === "balancing") return "Enter/Space toggles automatic balancing";
        if (row.type === "connect") return "Enter/C connects a new provider";
        if (confirmAccount() === `${row.providerID}/${row.alias}`) return "Y confirms removal · N cancels";
        return "R to rename · D requests removal confirmation";
    };
    const accountLabel = (account: { providerID: string; alias: string; authType: string }) =>
        `${account.providerID}/${account.alias} (${account.authType})`;
    const removeCurrent = () => {
        const row = current();
        if (row?.type === "account") setConfirmAccount(`${row.providerID}/${row.alias}`);
    };

    const toggleBalancing = () => {
        setBalancingEnabled(props.state.db, !balancing());
        refreshDashboard();
        props.state.refresh();
    };

    const confirmCurrent = () => {
        const row = current();
        if (row?.type === "account" && confirmAccount() === `${row.providerID}/${row.alias}`) {
            setConfirmAccount(undefined);
            props.removeAccount(row.providerID, row.alias);
            refreshDashboard();
        }
    };

    const runPrimary = () => {
        if (focusArea() === "header") {
            const action = currentHeader();
            if (action?.type === "close") return props.onBack();
            return props.openPriority();
        }
        const row = current();
        if (!row) return;
        if (row.type === "balancing") return toggleBalancing();
        if (row.type === "connect") return props.openConnect();
        if (row.type === "account") return setConfirmAccount(`${row.providerID}/${row.alias}`);
    };

    const handleKey = (event: KeyLike) => {
        if (props.api.ui.dialog.open) return;
        const intent = reduceDashboardKey({ name: event.name ?? "" });
        switch (intent.type) {
            case "move-cursor":
                {
                    const next = moveDashboardFocus(
                        { area: focusArea(), cursor: cursor(), rowCount: rows().length },
                        intent.delta,
                    );
                    setFocusArea(next.area);
                    setCursor(clampCursor(next.cursor));
                }
                return;
            case "move-header":
                setFocusArea("header");
                setHeaderCursor((value) => clampHeaderCursor(value + intent.delta));
                return;
            case "primary":
                runPrimary();
                return;
            case "priority":
                props.openPriority();
                return;
            case "connect":
                props.openConnect();
                return;
            case "rename": {
                const row = current();
                if (row?.type === "account") props.renameAccount(row.providerID, row.alias);
                return;
            }
            case "remove":
                removeCurrent();
                return;
            case "confirm":
                confirmCurrent();
                return;
            case "cancel":
                setConfirmAccount(undefined);
                return;
            case "back":
                props.onBack();
                return;
            default:
                return;
        }
    };

    let container: { focus?: () => void } | undefined;
    onMount(() => container?.focus?.());

    return (
        <box
            ref={(ref: unknown) => (container = ref as { focus?: () => void })}
            focusable
            onKeyDown={(event: KeyLike) => handleKey(event)}
            flexDirection="column"
            gap={0}
            padding={1}
            width="100%"
            height="100%"
        >
            <box flexDirection="column" gap={0} paddingBottom={1} flexShrink={0}>
                <text fg={theme().primary} wrapMode="none" overflow="hidden" truncate>
                    opencode-balancer{compact() ? "" : " control center"}
                </text>
                <Show when={!compact()}>
                    <text fg={theme().textMuted} wrapMode="none" overflow="hidden" truncate>
                        Manage accounts, usage, and provider failover.
                    </text>
                </Show>
                <box flexDirection="row" gap={1} height={1} flexShrink={0}>
                    <For each={headerActions}>
                        {(action, index) => (
                            <box
                                height={1}
                                flexShrink={0}
                                backgroundColor={headerSelected(action.key) ? selectedColors().bg : undefined}
                                onMouseUp={() => {
                                    setFocusArea("header");
                                    setHeaderCursor(index());
                                    if (action.type === "close") props.onBack();
                                    else props.openPriority();
                                }}
                            >
                                <text fg={headerSelected(action.key) ? selectedColors().fg : theme().accent} wrapMode="none">
                                    {headerMarker(action.key)} [ {action.label} ]
                                </text>
                            </box>
                        )}
                    </For>
                </box>
            </box>

            <scrollbox height={contentHeight()} scrollbarOptions={{ visible: false }}>
                <box flexDirection="column" gap={0} paddingBottom={1} onMouseUp={() => setCursor(0)}>
                    <SectionTitle label="BALANCING" />
                    <Row selected={selected("balancing")} onMouseUp={toggleBalancing}>
                        <text fg={selected("balancing") ? selectedColors().fg : balancing() ? theme().success : theme().textMuted} wrapMode="none" overflow="hidden" truncate>
                            {rowMarker("balancing")} Automatic balancing: {balancing() ? "ON" : "OFF"}
                        </text>
                    </Row>
                    <Show when={!compact()}>
                        <text fg={theme().textMuted} wrapMode="none" overflow="hidden" truncate>
                            Enter/Space toggles provider failover. Priority config is in the header.
                        </text>
                    </Show>
                </box>

                <box flexDirection="column" gap={0} paddingBottom={1}>
                    <SectionTitle label="ACCOUNTS" count={accounts().length} />
                    <box flexDirection="column" gap={0} flexShrink={0} onMouseUp={() => setCursor(rows().findIndex((row) => row.key === "connect"))}>
                        <Row selected={selected("connect")} onMouseUp={props.openConnect}>
                            <text fg={selected("connect") ? selectedColors().fg : theme().accent} wrapMode="none" overflow="hidden" truncate>
                                {rowMarker("connect")} New account
                            </text>
                        </Row>
                        <Show when={selected("connect") && !compact()}>
                            <text fg={theme().textMuted} wrapMode="none" overflow="hidden" truncate>
                                action: Enter/C opens opencode provider connection
                            </text>
                        </Show>
                    </box>
                    <Show when={accounts().length > 0} fallback={<text fg={theme().textMuted}>none</text>}>
                        <For each={accounts()}>
                            {(account) => (
                                <box flexDirection="column" gap={0} flexShrink={0} onMouseUp={() => setCursor(rows().findIndex((row) => row.key === `account:${account.providerID}/${account.alias}`))}>
                                    <Row selected={selected(`account:${account.providerID}/${account.alias}`)}>
                                        <text fg={selected(`account:${account.providerID}/${account.alias}`) ? selectedColors().fg : account.disabled ? theme().textMuted : theme().text} wrapMode="none" overflow="hidden" truncate>
                                            {rowMarker(`account:${account.providerID}/${account.alias}`)} {accountLabel(account)}
                                        </text>
                                    </Row>
                                    <Show when={!compact()}>
                                        <UsageSnapshotBar
                                            theme={theme()}
                                            snapshot={usage()[`${account.providerID}/${account.alias}`]}
                                            muted={!selected(`account:${account.providerID}/${account.alias}`)}
                                        />
                                    </Show>
                                    <Show
                                        when={confirmAccount() === `${account.providerID}/${account.alias}`}
                                        fallback={
                                            <Show when={selected(`account:${account.providerID}/${account.alias}`)}>
                                                <text fg={theme().textMuted} wrapMode="none" overflow="hidden" truncate>
                                                    action: press D to remove this account
                                                </text>
                                            </Show>
                                        }
                                    >
                                        <box flexDirection="row" gap={1}>
                                            <text fg={theme().warning} wrapMode="none">confirm removal?</text>
                                            <Button
                                                label="yes"
                                                danger
                                                onClick={() => {
                                                    setConfirmAccount(undefined);
                                                    props.removeAccount(account.providerID, account.alias);
                                                    refreshDashboard();
                                                }}
                                            />
                                            <Button label="no" onClick={() => setConfirmAccount(undefined)} />
                                        </box>
                                    </Show>
                                </box>
                            )}
                        </For>
                    </Show>
                </box>

            </scrollbox>

            <box flexDirection="column" gap={0}>
                <Show
                    when={!compact()}
                    fallback={
                        <text fg={theme().textMuted} wrapMode="none" truncate>
                            ↑↓ move · Enter open · Space toggle · P priority · Esc close
                        </text>
                    }
                >
                    <box flexDirection="row" gap={2}>
                        <Chip keyName="↑↓" label="Move" />
                        <Chip keyName="Enter" label="Open" />
                        <Chip keyName="Space" label="Toggle" />
                        <Chip keyName="C" label="Connect" />
                        <Chip keyName="P" label="Priority" />
                        <Chip keyName="R" label="Rename" />
                        <Chip keyName="D" label="Remove" danger />
                        <Chip keyName="Esc" label="Close" />
                    </box>
                </Show>
                <text fg={theme().textMuted} wrapMode="none" truncate>
                    selected: {selectedLabel()} · {selectedAction()}
                </text>
            </box>
        </box>
    );
}
