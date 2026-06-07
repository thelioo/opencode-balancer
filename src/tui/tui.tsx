/** @jsxImportSource @opentui/solid */

import type { TuiPlugin, TuiPluginModule, TuiRouteCurrent } from "@opencode-ai/plugin/tui";
import { createComponent } from "solid-js";
import { setProviderModel } from "../core/priority";
import { activateAccount, removeAccountFromTui } from "./actions";
import { createTuiBalancerBarSync } from "./balancer-bar-sync";
import { openNativeConnect } from "./connect";
import { createBalancerTuiState } from "./state";
import { createUsageAutoRefresh } from "./usage-auto-refresh";

type DashboardModule = typeof import("./components/dashboard");
type PriorityScreenModule = typeof import("./components/priority-screen");
type ProviderModelDialogModule = typeof import("./components/provider-model-dialog");
type RenameDialogModule = typeof import("./components/rename-dialog");
type SidebarModule = typeof import("./components/sidebar");
type StatusIndicatorModule = typeof import("./components/status-indicator");

function inferProviderID(session: unknown) {
    const providerID = (session as { model?: { providerID?: unknown } } | undefined)?.model?.providerID;
    return typeof providerID === "string" && providerID.length > 0 ? providerID : undefined;
}

function copyRoute(route: TuiRouteCurrent): TuiRouteCurrent {
    return "params" in route && route.params
        ? { name: route.name, params: { ...route.params } }
        : { name: route.name };
}

const tui: TuiPlugin = async (api) => {
    await import("@opentui/solid/runtime-plugin" + "-support");

    const [dashboardModule, priorityScreenModule, providerModelDialogModule, renameDialogModule, sidebarModule, statusIndicatorModule] = await Promise.all([
        import("./components/dashboard" + ".tsx") as Promise<DashboardModule>,
        import("./components/priority-screen" + ".tsx") as Promise<PriorityScreenModule>,
        import("./components/provider-model-dialog" + ".tsx") as Promise<ProviderModelDialogModule>,
        import("./components/rename-dialog" + ".tsx") as Promise<RenameDialogModule>,
        import("./components/sidebar" + ".tsx") as Promise<SidebarModule>,
        import("./components/status-indicator" + ".tsx") as Promise<StatusIndicatorModule>,
    ]);
    const state = createBalancerTuiState();
    const usageAutoRefresh = createUsageAutoRefresh(api, state);
    const balancerBarSync = createTuiBalancerBarSync(api, state);
    let dashboardReturnRoute: TuiRouteCurrent | undefined;

    api.lifecycle.onDispose(() => {
        usageAutoRefresh.dispose();
        state.dispose();
    });

    const openDashboard = () => {
        if (api.route.current.name !== "balancer.dashboard") dashboardReturnRoute = copyRoute(api.route.current);
        api.route.navigate("balancer.dashboard");
    };

    const openPriority = () => {
        api.route.navigate("balancer.priority");
    };

    const backFromDashboard = () => {
        const route = dashboardReturnRoute;
        dashboardReturnRoute = undefined;
        if (route) api.route.navigate(route.name, "params" in route ? route.params : undefined);
        else api.route.navigate("home");
    };

    const unregisterDashboard = api.route.register([
        {
            name: "balancer.dashboard",
            render: () =>
                createComponent(dashboardModule.Dashboard, {
                    api,
                    state,
                    onBack: backFromDashboard,
                    openPriority,
                    openConnect: () => openNativeConnect({ ...api, db: state.db }),
                    renameAccount: (providerID, alias) => renameDialogModule.openRenameDialog(api, state, providerID, alias),
                    removeAccount: (providerID, alias) => removeAccountFromTui(api, state, providerID, alias),
                }),
        },
        {
            name: "balancer.priority",
            render: () =>
                createComponent(priorityScreenModule.PriorityScreen, {
                    api,
                    state,
                    onBack: () => api.route.navigate("balancer.dashboard"),
                    openModelPicker: (providerID) =>
                        providerModelDialogModule.openProviderModelDialog(api, state, providerID, {
                            onSelected: (model) => setProviderModel(state.db, model.providerID, model.modelID),
                        }),
                }),
        },
    ]);
    api.lifecycle.onDispose(unregisterDashboard);

    const unregisterKeymap = api.keymap.registerLayer({
        commands: [
            {
                name: "balancer.dashboard.open",
                title: "Open Balancer Dashboard",
                category: "Plugin",
                namespace: "palette",
                slashName: "balancer",
                run() {
                    openDashboard();
                },
            },
        ],
        bindings: [{ key: "ctrl+b", cmd: "balancer.dashboard.open" }],
    });
    api.lifecycle.onDispose(unregisterKeymap);

    api.slots.register({
        slots: {
            session_prompt_right(_ctx, value) {
                void usageAutoRefresh.refreshForPrompt();
                void balancerBarSync.maybeSync();
                return createComponent(statusIndicatorModule.BalancerStatusIndicator, {
                    api,
                    state,
                    providerID: () => inferProviderID(api.state.session.get(value.session_id)),
                });
            },
            sidebar_content(_ctx, value) {
                return createComponent(sidebarModule.BalancerSidebar, {
                    api,
                    state,
                    openDashboard,
                    activateAccount: (providerID, alias) =>
                        activateAccount(api, state, providerID, alias, {
                            sessionProviderID: inferProviderID(api.state.session.get(value.session_id)),
                            openProviderModelPicker: (targetProviderID) =>
                                providerModelDialogModule.openProviderModelDialog(api, state, targetProviderID),
                        }),
                });
            },
        },
    });
};

export default { id: "opencode-balancer", tui } satisfies TuiPluginModule;
