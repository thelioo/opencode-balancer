/** @jsxImportSource @opentui/solid */

import type {
	TuiPlugin,
	TuiPluginModule,
	TuiRouteCurrent,
} from "@opencode-ai/plugin/tui";
import { createComponent } from "solid-js";
import { getSelectedModel } from "../core/accounts";
import { setProviderModel } from "../core/priority";
import { activateAccount, removeAccountFromTui } from "./actions";
import { createTuiBalancerBarSync } from "./balancer-bar-sync";
import { openNativeConnect } from "./connect";
import { createNativeModelApplier } from "./native-model-apply";
import { providerModelOptions } from "./provider-models";
import { createSelectedAccountBarSync } from "./selected-account-bar-sync";
import { createBalancerTuiState } from "./state";
import { createUsageAutoRefresh } from "./usage-auto-refresh";

type DashboardModule = typeof import("./components/dashboard");
type PriorityScreenModule = typeof import("./components/priority-screen");
type ProviderModelDialogModule =
	typeof import("./components/provider-model-dialog");
type RenameDialogModule = typeof import("./components/rename-dialog");
type SidebarModule = typeof import("./components/sidebar");
type StatusIndicatorModule = typeof import("./components/status-indicator");

function inferProviderID(session: unknown) {
	const providerID = (
		session as { model?: { providerID?: unknown } } | undefined
	)?.model?.providerID;
	return typeof providerID === "string" && providerID.length > 0
		? providerID
		: undefined;
}

function copyRoute(route: TuiRouteCurrent): TuiRouteCurrent {
	return "params" in route && route.params
		? { name: route.name, params: { ...route.params } }
		: { name: route.name };
}

const tui: TuiPlugin = async (api) => {
	await import("@opentui/solid/runtime-plugin" + "-support");

	const [
		dashboardModule,
		priorityScreenModule,
		providerModelDialogModule,
		renameDialogModule,
		sidebarModule,
		statusIndicatorModule,
	] = await Promise.all([
		import("./components/dashboard" + ".tsx") as Promise<DashboardModule>,
		import(
			"./components/priority-screen" + ".tsx"
		) as Promise<PriorityScreenModule>,
		import(
			"./components/provider-model-dialog" + ".tsx"
		) as Promise<ProviderModelDialogModule>,
		import(
			"./components/rename-dialog" + ".tsx"
		) as Promise<RenameDialogModule>,
		import("./components/sidebar" + ".tsx") as Promise<SidebarModule>,
		import(
			"./components/status-indicator" + ".tsx"
		) as Promise<StatusIndicatorModule>,
	]);
	const state = createBalancerTuiState();
	const usageAutoRefresh = createUsageAutoRefresh(api, state);
	const balancerBarSync = createTuiBalancerBarSync(api, state);
	const nativeModelApplier = createNativeModelApplier(api);
	let dashboardReturnRoute: TuiRouteCurrent | undefined;
	let nativeProviderID: string | undefined;
	let sessionProviderID: string | undefined;

	const applyNativeProviderModel = async (providerID: string) => {
		const modelOptions = providerModelOptions(api.state.provider, providerID);
		const selected = getSelectedModel(state.db, providerID);
		const option =
			modelOptions.find((item) => item.modelID === selected?.modelID) ??
			modelOptions[0];
		if (!option) return false;
		return nativeModelApplier(
			{ modelID: option.modelID, providerID: option.providerID },
			option.title,
		);
	};

	const applyNativeProviderModelAndTrack = async (providerID: string) => {
		const applied = await applyNativeProviderModel(providerID);
		if (applied) nativeProviderID = providerID;
		return applied;
	};

	const selectedAccountBarSync = createSelectedAccountBarSync({
		applyProvider: applyNativeProviderModelAndTrack,
		currentProvider: () => nativeProviderID ?? sessionProviderID,
		dialogOpen: () => api.ui.dialog.open,
		// Cache-backed, not a live query — this closure runs on every
		// session_prompt_right render (including mid-stream), same reasoning
		// as balancer-bar-sync.ts.
		selectedProvider: () => {
			const snapshot = state.snapshot();
			return snapshot?.balancingEnabled
				? undefined
				: snapshot?.selectedAccount?.providerID;
		},
	});

	api.lifecycle.onDispose(() => {
		usageAutoRefresh.dispose();
		state.dispose();
	});

	const openDashboard = () => {
		if (api.route.current.name !== "balancer.dashboard")
			dashboardReturnRoute = copyRoute(api.route.current);
		api.route.navigate("balancer.dashboard");
	};

	const openPriority = () => {
		api.route.navigate("balancer.priority");
	};

	const backFromDashboard = () => {
		const route = dashboardReturnRoute;
		dashboardReturnRoute = undefined;
		if (route)
			api.route.navigate(
				route.name,
				"params" in route ? route.params : undefined,
			);
		else api.route.navigate("home");
	};

	const unregisterDashboard = api.route.register([
		{
			name: "balancer.dashboard",
			render: () =>
				createComponent(dashboardModule.Dashboard, {
					api,
					onBack: backFromDashboard,
					openConnect: () => openNativeConnect({ ...api, db: state.db }),
					openPriority,
					removeAccount: (providerID, alias) =>
						removeAccountFromTui(api, state, providerID, alias),
					renameAccount: (providerID, alias) =>
						renameDialogModule.openRenameDialog(api, state, providerID, alias),
					state,
				}),
		},
		{
			name: "balancer.priority",
			render: () =>
				createComponent(priorityScreenModule.PriorityScreen, {
					api,
					onBack: () => api.route.navigate("balancer.dashboard"),
					openModelPicker: (providerID, onComplete) =>
						providerModelDialogModule.openProviderModelDialog(
							api,
							state,
							providerID,
							{
								applyNativeSelection: false,
								onComplete,
								onSelected: (model) =>
									setProviderModel(state.db, model.providerID, model.modelID),
							},
						),
					state,
				}),
		},
	]);
	api.lifecycle.onDispose(unregisterDashboard);

	if (api.command) {
		const unregisterCommand = api.command.register(() => [
			{
				category: "Plugin",
				description: "Open the Balancer dashboard.",
				keybind: "ctrl+b",
				onSelect() {
					openDashboard();
				},
				slash: { name: "balancer" },
				title: "Open Balancer Dashboard",
				value: "balancer.dashboard.open",
			},
		]);
		api.lifecycle.onDispose(unregisterCommand);
	} else {
		const unregisterKeymap = api.keymap.registerLayer({
			bindings: [{ cmd: "balancer.dashboard.open", key: "ctrl+b" }],
			commands: [
				{
					category: "Plugin",
					name: "balancer.dashboard.open",
					namespace: "palette",
					run() {
						openDashboard();
					},
					slashName: "balancer",
					title: "Open Balancer Dashboard",
				},
			],
		});
		api.lifecycle.onDispose(unregisterKeymap);
	}

	api.slots.register({
		slots: {
			session_prompt_right(_ctx, value) {
				sessionProviderID = inferProviderID(
					api.state.session.get(value.session_id),
				);
				void usageAutoRefresh.refreshForPrompt();
				void selectedAccountBarSync.maybeSync();
				void balancerBarSync.maybeSync();
				return createComponent(statusIndicatorModule.BalancerStatusIndicator, {
					api,
					providerID: () =>
						inferProviderID(api.state.session.get(value.session_id)),
					state,
				});
			},
			sidebar_content(_ctx, value) {
				return createComponent(sidebarModule.BalancerSidebar, {
					activateAccount: (providerID, alias) => {
						return activateAccount(api, state, providerID, alias, {
							applyNativeProviderModel: applyNativeProviderModelAndTrack,
							sessionProviderID:
								nativeProviderID ??
								inferProviderID(api.state.session.get(value.session_id)),
						});
					},
					api,
					openDashboard,
					state,
				});
			},
		},
	});
};

export default { id: "opencode-balancer", tui } satisfies TuiPluginModule;
