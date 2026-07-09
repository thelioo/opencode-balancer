import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function createApi() {
	return {
		keymap: { registerLayer: () => () => {} },
		lifecycle: {
			onDispose: () => () => {},
			signal: new AbortController().signal,
		},
		renderer: {},
		route: {
			current: { name: "home" },
			navigate: () => {},
			register: () => () => {},
		},
		slots: { register: () => "test-slot" },
		state: { provider: [], session: { get: () => undefined } },
		theme: { current: {} },
		ui: { dialog: { open: false }, toast: () => {} },
	} as any;
}

describe("TUI artifacts", () => {
	test("disables native model replay for the priority model picker", () => {
		const artifact = join(import.meta.dir, "../../src/tui/tui.tsx");
		const source = readFileSync(artifact, "utf8");
		const priorityRoute = source.slice(
			source.indexOf('name: "balancer.priority"'),
			source.indexOf("}),", source.indexOf('name: "balancer.priority"')),
		);

		expect(priorityRoute).toContain("openProviderModelDialog");
		expect(priorityRoute).toContain("providerID");
		expect(priorityRoute).toContain("applyNativeSelection: false");
	});

	test("uses compiled JavaScript for the built TUI export", () => {
		const distDir = join(import.meta.dir, "../../dist");
		if (!existsSync(distDir)) return;

		const artifact = join(import.meta.dir, "../../dist/tui/tui.js");
		const dashboardArtifact = join(
			import.meta.dir,
			"../../dist/tui/components/dashboard.js",
		);
		const copiedSource = join(import.meta.dir, "../../dist/tui/tui.tsx");
		expect(existsSync(artifact)).toBe(true);
		expect(existsSync(dashboardArtifact)).toBe(true);
		expect(existsSync(copiedSource)).toBe(false);
	});

	test("keeps OpenTUI component rendering out of the TUI entry artifact", () => {
		const artifact = join(import.meta.dir, "../../dist/tui/tui.js");
		if (!existsSync(artifact)) return;

		const source = readFileSync(artifact, "utf8");
		expect(source).toContain("runtime-plugin-support");
		expect(source).not.toContain("createElement as");
		expect(source).not.toContain("createElement");
	});

	test("uses OpenCode plugin module shapes for built entries", async () => {
		const distDir = join(import.meta.dir, "../../dist");
		if (!existsSync(distDir)) return;

		const serverModule = (await import("../../dist/index.js" as string)) as {
			default: Record<string, unknown>;
		};
		const tuiModule = (await import("../../dist/tui/tui.js" as string)) as {
			default: Record<string, unknown>;
		};

		expect(typeof serverModule.default).toBe("function");
		expect(serverModule.default.id).toBe("opencode-balancer");
		expect(typeof serverModule.default.tui).toBe("function");
		expect(typeof tuiModule.default).toBe("object");
		expect(typeof tuiModule.default.tui).toBe("function");
		expect("server" in tuiModule.default).toBe(false);
	});

	test("initializes built TUI from both package entrypoints", async () => {
		const distDir = join(import.meta.dir, "../../dist");
		if (!existsSync(distDir)) return;

		const configDir = mkdtempSync(join(tmpdir(), "opencode-balancer-dist-"));
		const previousConfigDir = Bun.env.OPENCODE_CONFIG_DIR;
		Bun.env.OPENCODE_CONFIG_DIR = configDir;
		try {
			const serverModule = (await import("../../dist/index.js" as string)) as {
				default: { tui: (api: unknown) => Promise<void> };
			};
			const tuiModule = (await import("../../dist/tui/tui.js" as string)) as {
				default: { tui: (api: unknown) => Promise<void> };
			};

			await expect(
				serverModule.default.tui(createApi()),
			).resolves.toBeUndefined();
			await expect(tuiModule.default.tui(createApi())).resolves.toBeUndefined();
		} finally {
			if (previousConfigDir === undefined) delete Bun.env.OPENCODE_CONFIG_DIR;
			else Bun.env.OPENCODE_CONFIG_DIR = previousConfigDir;
			rmSync(configDir, { force: true, recursive: true });
		}
	});

	test("strips embedded source content from generated source maps", async () => {
		const sourceMap = join(import.meta.dir, "../../dist/index.js.map");
		if (!existsSync(sourceMap)) return;

		const map = await Bun.file(sourceMap).json();
		expect(map).not.toHaveProperty("sourcesContent");
	});
});
