import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getSelectedModel, saveAccount } from "../../src/core/accounts";
import {
	closeBalancerDatabase,
	openBalancerDatabase,
} from "../../src/core/database";
import { listProviderPriority } from "../../src/core/priority";
import { migrate } from "../../src/core/schema";

let dbPaths: string[] = [];

afterEach(() => {
	for (const dbPath of dbPaths) {
		closeBalancerDatabase(dbPath);
		rmSync(dbPath, { force: true });
		rmSync(`${dbPath}-wal`, { force: true });
		rmSync(`${dbPath}-shm`, { force: true });
	}
	dbPaths = [];
});

function createDb() {
	const dbPath = join(
		mkdtempSync(join(tmpdir(), "opencode-balancer-provider-model-dialog-")),
		"balancer.sqlite",
	);
	dbPaths.push(dbPath);
	const db = openBalancerDatabase(dbPath);
	migrate(db);
	return db;
}

type SelectProps = {
	options: { value: { providerID: string; modelID: string; title: string } }[];
	onSelect?: (option: {
		value: { providerID: string; modelID: string; title: string };
	}) => void;
};

function createApi(
	onSelectCapture: (props: SelectProps) => void,
	toasts: unknown[],
	cleared: { value: boolean },
) {
	return {
		state: {
			provider: [
				{
					id: "github-copilot",
					models: {
						"claude-haiku-4.5": {
							id: "claude-haiku-4.5",
							name: "Claude Haiku 4.5",
							release_date: "2026-02-01",
						},
					},
					name: "GitHub Copilot",
				},
				{
					id: "openai",
					models: {
						"gpt-5.5": {
							id: "gpt-5.5",
							name: "GPT-5.5",
							release_date: "2026-01-01",
						},
					},
					name: "OpenAI",
				},
			],
		},
		ui: {
			DialogSelect: (props: SelectProps) => {
				onSelectCapture(props);
				return null;
			},
			dialog: {
				clear: () => {
					cleared.value = true;
				},
				replace: (render: () => unknown) => render(),
				setSize: () => {},
			},
			toast: (input: unknown) => toasts.push(input),
		},
	};
}

describe("openProviderModelDialog", () => {
	test("lists only the selected provider's models", async () => {
		await import("@opentui/solid/runtime-plugin" + "-support");
		const { openProviderModelDialog } = await import(
			"../../src/tui/components/provider-model-dialog" + ".tsx"
		);
		const db = createDb();
		saveAccount(db, "openai", "op1", { key: "sk", type: "api" });
		const toasts: unknown[] = [];
		const cleared = { value: false };
		let selectProps: SelectProps | undefined;

		const api = createApi((props) => (selectProps = props), toasts, cleared);

		openProviderModelDialog(
			api as never,
			{ db, refresh: () => {} } as never,
			"github-copilot",
			{
				applyNativeSelection: async () => true,
			},
		);

		expect(
			selectProps?.options.map((option) => option.value.providerID),
		).toEqual(["github-copilot"]);
		expect(selectProps?.options.map((option) => option.value.modelID)).toEqual([
			"claude-haiku-4.5",
		]);
	});

	test("persists the selection, closes the picker, replays into the native dialog, and confirms", async () => {
		await import("@opentui/solid/runtime-plugin" + "-support");
		const { openProviderModelDialog } = await import(
			"../../src/tui/components/provider-model-dialog" + ".tsx"
		);
		const db = createDb();
		const toasts: unknown[] = [];
		const cleared = { value: false };
		const applied: {
			model: { providerID: string; modelID: string };
			title: string;
		}[] = [];
		let selectProps: SelectProps | undefined;

		const api = createApi((props) => (selectProps = props), toasts, cleared);

		openProviderModelDialog(
			api as never,
			{ db, refresh: () => {} } as never,
			"github-copilot",
			{
				applyNativeSelection: async (
					model: { providerID: string; modelID: string },
					title: string,
				) => {
					applied.push({ model, title });
					return true;
				},
			},
		);
		selectProps?.onSelect?.(selectProps.options[0]);
		await Promise.resolve();

		expect(getSelectedModel(db, "github-copilot")).toEqual({
			modelID: "claude-haiku-4.5",
			providerID: "github-copilot",
		});
		expect(cleared.value).toBe(true);
		expect(applied).toEqual([
			{
				model: { modelID: "claude-haiku-4.5", providerID: "github-copilot" },
				title: "Claude Haiku 4.5",
			},
		]);
		expect(toasts).toEqual([
			{
				message: "Switched to GitHub Copilot/Claude Haiku 4.5.",
				variant: "success",
			},
		]);
	});

	test("can persist the selection through a custom onSelected handler", async () => {
		await import("@opentui/solid/runtime-plugin" + "-support");
		const { openProviderModelDialog } = await import(
			"../../src/tui/components/provider-model-dialog" + ".tsx"
		);
		const { setProviderModel } = await import("../../src/core/priority");
		const db = createDb();
		saveAccount(db, "openai", "op1", { key: "sk", type: "api" });
		const toasts: unknown[] = [];
		const cleared = { value: false };
		let selectProps: SelectProps | undefined;

		const api = createApi((props) => (selectProps = props), toasts, cleared);

		openProviderModelDialog(
			api as never,
			{ db, refresh: () => {} } as never,
			"openai",
			{
				applyNativeSelection: async () => true,
				onSelected: (model: { providerID: string; modelID: string }) =>
					setProviderModel(db, model.providerID, model.modelID),
			},
		);
		selectProps?.onSelect?.(selectProps.options[0]);
		await Promise.resolve();

		expect(
			listProviderPriority(db).find((entry) => entry.providerID === "openai")
				?.modelID,
		).toBe("gpt-5.5");
		expect(getSelectedModel(db, "openai")).toBeUndefined();
	});

	test("warns (but still persists) when the native dialog could not be driven", async () => {
		await import("@opentui/solid/runtime-plugin" + "-support");
		const { openProviderModelDialog } = await import(
			"../../src/tui/components/provider-model-dialog" + ".tsx"
		);
		const db = createDb();
		const toasts: unknown[] = [];
		const cleared = { value: false };
		let selectProps: SelectProps | undefined;

		const api = createApi((props) => (selectProps = props), toasts, cleared);

		openProviderModelDialog(
			api as never,
			{ db, refresh: () => {} } as never,
			"openai",
			{
				applyNativeSelection: async () => false,
			},
		);
		selectProps?.onSelect?.(selectProps.options[0]);
		await Promise.resolve();

		expect(getSelectedModel(db, "openai")).toEqual({
			modelID: "gpt-5.5",
			providerID: "openai",
		});
		expect(cleared.value).toBe(true);
		expect(toasts).toEqual([
			{
				message:
					"Selected OpenAI/GPT-5.5; prompts will use it, but opencode's model bar may not have refreshed.",
				variant: "warning",
			},
		]);
	});

	test("notifies after native model application so the caller can restore keyboard focus", async () => {
		await import("@opentui/solid/runtime-plugin" + "-support");
		const { openProviderModelDialog } = await import(
			"../../src/tui/components/provider-model-dialog" + ".tsx"
		);
		const db = createDb();
		const toasts: unknown[] = [];
		const cleared = { value: false };
		const order: string[] = [];
		let selectProps: SelectProps | undefined;

		const api = createApi((props) => (selectProps = props), toasts, cleared);

		openProviderModelDialog(
			api as never,
			{ db, refresh: () => order.push("refresh") } as never,
			"openai",
			{
				applyNativeSelection: async () => {
					order.push("apply");
					return true;
				},
				onComplete: () => order.push("complete"),
			},
		);
		selectProps?.onSelect?.(selectProps.options[0]);
		await Promise.resolve();
		await Promise.resolve();

		expect(order).toEqual(["refresh", "apply", "complete"]);
	});

	test("can persist without replaying through the native model dialog", async () => {
		await import("@opentui/solid/runtime-plugin" + "-support");
		const { openProviderModelDialog } = await import(
			"../../src/tui/components/provider-model-dialog" + ".tsx"
		);
		const { setProviderModel } = await import("../../src/core/priority");
		const db = createDb();
		saveAccount(db, "openai", "op1", { key: "sk", type: "api" });
		const toasts: unknown[] = [];
		const cleared = { value: false };
		const order: string[] = [];
		let selectProps: SelectProps | undefined;

		const api = createApi((props) => (selectProps = props), toasts, cleared);

		openProviderModelDialog(
			api as never,
			{ db, refresh: () => order.push("refresh") } as never,
			"openai",
			{
				applyNativeSelection: false,
				onComplete: () => order.push("complete"),
				onSelected: (model: { providerID: string; modelID: string }) =>
					setProviderModel(db, model.providerID, model.modelID),
			},
		);
		selectProps?.onSelect?.(selectProps.options[0]);
		await Promise.resolve();

		expect(
			listProviderPriority(db).find((entry) => entry.providerID === "openai")
				?.modelID,
		).toBe("gpt-5.5");
		expect(cleared.value).toBe(true);
		expect(order).toEqual(["refresh", "complete"]);
		expect(toasts).toEqual([]);
	});
});
