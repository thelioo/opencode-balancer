import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const compact = (source: string) => source.replace(/\s+/g, "");
const expectSourceToContain = (source: string, snippet: string) =>
	expect(compact(source)).toContain(compact(snippet));

import type { TuiRouteDefinition } from "@opencode-ai/plugin/tui";
import plugin from "../../src/tui/tui";

let configDirs: string[] = [];

afterEach(() => {
	for (const dir of configDirs) {
		rmSync(dir, { force: true, recursive: true });
	}
	configDirs = [];
	delete Bun.env.OPENCODE_CONFIG_DIR;
});

function withTempConfigDir() {
	const dir = mkdtempSync(join(tmpdir(), "opencode-balancer-tui-plugin-"));
	configDirs.push(dir);
	Bun.env.OPENCODE_CONFIG_DIR = dir;
}

function createApi() {
	const routes: TuiRouteDefinition[] = [];
	const keymapLayers: any[] = [];
	const navigations: unknown[] = [];
	const toasts: unknown[] = [];
	const dialogs: unknown[] = [];
	const dialogSizes: string[] = [];
	const disposes: Array<() => void | Promise<void>> = [];

	return {
		api: {
			app: { version: "test" },
			attention: {},
			client: {},
			event: {},
			keymap: {
				registerLayer: (layer: any) => {
					keymapLayers.push(layer);
					return () => {};
				},
			},
			keys: {},
			kv: {},
			lifecycle: {
				onDispose: (fn: () => void | Promise<void>) => {
					disposes.push(fn);
					return () => {};
				},
				signal: new AbortController().signal,
			},
			mode: {},
			plugins: {},
			renderer: {},
			route: {
				current: { name: "home" },
				navigate: (name: string, params?: Record<string, unknown>) => {
					navigations.push({ name, params });
				},
				register: (registered: TuiRouteDefinition[]) => {
					routes.push(...registered);
					return () => {};
				},
			},
			slots: {
				register: () => "test-slot",
			},
			state: {
				session: {
					get: () => undefined,
				},
			},
			theme: {
				current: {
					accent: "accent",
					primary: "primary",
					text: "text",
					textMuted: "textMuted",
					warning: "warning",
				},
			},
			tuiConfig: {},
			ui: {
				dialog: {
					clear: () => dialogs.push("clear"),
					open: false,
					replace: (render: () => unknown) => dialogs.push(render),
					setSize: (size: string) => dialogSizes.push(size),
				},
				toast: (input: unknown) => {
					toasts.push(input);
				},
			},
		} as any,
		dialogSizes,
		dialogs,
		disposes,
		keymapLayers,
		navigations,
		routes,
		toasts,
	};
}

describe("tui plugin", () => {
	test("registers dashboard routes, palette command, and keyboard shortcut", async () => {
		withTempConfigDir();
		const {
			api,
			routes,
			keymapLayers,
			navigations,
			dialogs,
			dialogSizes,
			toasts,
			disposes,
		} = createApi();

		await plugin.tui(api, undefined, {} as any);

		expect(routes.map((route) => route.name)).toEqual([
			"balancer.dashboard",
			"balancer.priority",
		]);
		const commands = keymapLayers.flatMap((layer) => layer.commands ?? []);
		const bindings = keymapLayers.flatMap((layer) => layer.bindings ?? []);
		const open = commands.find(
			(command) => command.name === "balancer.dashboard.open",
		);
		const refresh = commands.find(
			(command) => command.name === "balancer.usage.refresh",
		);

		expect(open).toMatchObject({
			category: "Plugin",
			namespace: "palette",
			slashName: "balancer",
			title: "Open Balancer Dashboard",
		});
		expect(refresh).toBeUndefined();
		expect(bindings).toContainEqual({
			cmd: "balancer.dashboard.open",
			key: "ctrl+b",
		});

		open.run();

		expect(dialogSizes).toEqual([]);
		expect(dialogs).toEqual([]);
		expect(navigations).toEqual([
			{ name: "balancer.dashboard", params: undefined },
		]);
		expect(toasts).toEqual([]);

		for (const dispose of disposes) await dispose();
	});

	test("passes dynamic session provider lookups to reactive sidebar/status handlers", async () => {
		const source = await Bun.file(
			join(import.meta.dir, "../../src/tui/tui.tsx"),
		).text();

		expectSourceToContain(
			source,
			"providerID: () => inferProviderID(api.state.session.get(value.session_id))",
		);
		expectSourceToContain(
			source,
			"sessionProviderID: nativeProviderID ?? inferProviderID(api.state.session.get(value.session_id))",
		);
	});

	test("does not open the balancer model picker from sidebar account activation", async () => {
		const source = await Bun.file(
			join(import.meta.dir, "../../src/tui/tui.tsx"),
		).text();
		const sidebarContent = source.slice(
			source.indexOf("sidebar_content"),
			source.indexOf("});", source.indexOf("sidebar_content")),
		);

		expect(sidebarContent).toContain(
			"activateAccount(api, state, providerID, alias",
		);
		expect(sidebarContent).toContain("applyNativeProviderModel");
		expect(source).toContain(
			"const nativeModelApplier = createNativeModelApplier(api)",
		);
		expect(sidebarContent).not.toContain(
			"openProviderModelDialog(api, state, targetProviderID)",
		);
	});

	test("does not replay priority model choices through opencode's native model dialog", async () => {
		const source = await Bun.file(
			join(import.meta.dir, "../../src/tui/tui.tsx"),
		).text();
		const priorityRoute = source.slice(
			source.indexOf('name: "balancer.priority"'),
			source.indexOf("}),", source.indexOf('name: "balancer.priority"')),
		);

		expectSourceToContain(
			priorityRoute,
			"openProviderModelDialog(api, state, providerID",
		);
		expect(priorityRoute).toContain("applyNativeSelection: false");
	});

	test("tracks the last natively applied provider before activating sidebar accounts", async () => {
		const source = await Bun.file(
			join(import.meta.dir, "../../src/tui/tui.tsx"),
		).text();
		const sidebarContent = source.slice(
			source.indexOf("sidebar_content"),
			source.indexOf("});", source.indexOf("sidebar_content")),
		);

		expect(source).toContain("let nativeProviderID: string | undefined");
		expectSourceToContain(
			sidebarContent,
			"sessionProviderID: nativeProviderID ?? inferProviderID(api.state.session.get(value.session_id))",
		);
		expect(source).toContain("if (applied) nativeProviderID = providerID");
	});

	test("syncs the native bar to the selected balancer account on session render", async () => {
		const source = await Bun.file(
			join(import.meta.dir, "../../src/tui/tui.tsx"),
		).text();
		const promptRight = source.slice(
			source.indexOf("session_prompt_right"),
			source.indexOf("sidebar_content"),
		);

		expect(source).toContain("createSelectedAccountBarSync");
		expectSourceToContain(
			promptRight,
			"sessionProviderID = inferProviderID(api.state.session.get(value.session_id),)",
		);
		expect(promptRight).toContain("void selectedAccountBarSync.maybeSync()");
	});
});
