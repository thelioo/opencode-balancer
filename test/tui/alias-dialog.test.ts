import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	closeBalancerDatabase,
	openBalancerDatabase,
} from "../../src/core/database";
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
		mkdtempSync(join(tmpdir(), "opencode-balancer-dialog-")),
		"balancer.sqlite",
	);
	dbPaths.push(dbPath);
	const db = openBalancerDatabase(dbPath);
	migrate(db);
	return db;
}

describe("openAliasDialog", () => {
	test("opens a previously prompted pending connection so the alias can be recovered", async () => {
		await import("@opentui/solid/runtime-plugin" + "-support");
		const { claimPendingPrompt, createPendingConnection } = await import(
			"../../src/core/pending"
		);
		const { openAliasDialog } = await import(
			"../../src/tui/components/alias-dialog" + ".tsx"
		);
		const database = createDb();
		const pending = createPendingConnection(
			database,
			"openai",
			{ key: "k", type: "api" },
			"auth-file",
		);
		claimPendingPrompt(database, pending.id);
		let replaces = 0;
		let promptProps: { onCancel?: () => unknown } | undefined;
		const api = {
			theme: { current: { textMuted: "muted" } },
			ui: {
				DialogPrompt: (props: { onCancel?: () => unknown }) => {
					promptProps = props;
					return null;
				},
				dialog: {
					clear: () => {},
					replace: (render: () => unknown) => {
						replaces++;
						return render();
					},
					setSize: () => {},
				},
				toast: () => {},
			},
		};
		const state = {
			db: database,
			pending: () => [
				{
					authType: "api",
					id: pending.id,
					promptStatus: "prompted",
					providerID: "openai",
				},
			],
			refresh: () => {},
		};

		expect(openAliasDialog(api as never, state as never, pending.id)).toBe(
			true,
		);
		promptProps?.onCancel?.();

		expect(replaces).toBe(1);
	});

	test("keeps a pending connection actionable when opening the dialog fails", async () => {
		await import("@opentui/solid/runtime-plugin" + "-support");
		const { createPendingConnection, listPendingConnections } = await import(
			"../../src/core/pending"
		);
		const { openAliasDialog } = await import(
			"../../src/tui/components/alias-dialog" + ".tsx"
		);
		const database = createDb();
		const pending = createPendingConnection(
			database,
			"openai",
			{ key: "k", type: "api" },
			"auth-file",
		);
		const api = {
			theme: { current: { textMuted: "muted" } },
			ui: {
				DialogPrompt: () => null,
				dialog: {
					clear: () => {},
					replace: () => {
						throw new Error("dialog unavailable");
					},
					setSize: () => {},
				},
				toast: () => {},
			},
		};
		const state = {
			db: database,
			pending: () => [
				{ authType: "api", id: pending.id, providerID: "openai" },
			],
			refresh: () => {},
		};

		expect(openAliasDialog(api as never, state as never, pending.id)).toBe(
			false,
		);

		expect(
			listPendingConnections(database).map((item) => item.promptStatus),
		).toEqual(["new"]);
	});

	test("does not open duplicate alias dialogs for the same pending connection", async () => {
		await import("@opentui/solid/runtime-plugin" + "-support");
		const { createPendingConnection } = await import("../../src/core/pending");
		const { openAliasDialog } = await import(
			"../../src/tui/components/alias-dialog" + ".tsx"
		);
		const database = createDb();
		const pending = createPendingConnection(
			database,
			"openai",
			{ key: "k", type: "api" },
			"auth-file",
		);
		let replaces = 0;
		let promptProps: { onCancel?: () => unknown } | undefined;
		const api = {
			theme: { current: { textMuted: "muted" } },
			ui: {
				DialogPrompt: (props: { onCancel?: () => unknown }) => {
					promptProps = props;
					return null;
				},
				dialog: {
					clear: () => {},
					replace: (render: () => unknown) => {
						replaces++;
						return render();
					},
					setSize: () => {},
				},
				toast: () => {},
			},
		};
		const state = {
			db: database,
			pending: () => [
				{ authType: "api", id: pending.id, providerID: "openai" },
			],
			refresh: () => {},
		};

		openAliasDialog(api as never, state as never, pending.id);
		openAliasDialog(api as never, state as never, pending.id);
		promptProps?.onCancel?.();

		expect(replaces).toBe(1);
	});

	test("reopens a pending alias dialog after the TUI dialog was externally cleared", async () => {
		await import("@opentui/solid/runtime-plugin" + "-support");
		const { createPendingConnection } = await import("../../src/core/pending");
		const { openAliasDialog } = await import(
			"../../src/tui/components/alias-dialog" + ".tsx"
		);
		const database = createDb();
		const pending = createPendingConnection(
			database,
			"openai",
			{ key: "stale", type: "api" },
			"auth-file",
		);
		let dialogOpen = false;
		let replaces = 0;
		const api = {
			theme: { current: { textMuted: "muted" } },
			ui: {
				DialogPrompt: () => null,
				dialog: {
					clear: () => {
						dialogOpen = false;
					},
					get open() {
						return dialogOpen;
					},
					replace: (render: () => unknown) => {
						dialogOpen = true;
						replaces++;
						return render();
					},
					setSize: () => {},
				},
				toast: () => {},
			},
		};
		const state = {
			db: database,
			pending: () => [
				{
					authType: "api",
					id: pending.id,
					promptStatus: "new",
					providerID: "openai",
				},
			],
			refresh: () => {},
		};

		expect(openAliasDialog(api as never, state as never, pending.id)).toBe(
			true,
		);
		dialogOpen = false;
		expect(openAliasDialog(api as never, state as never, pending.id)).toBe(
			true,
		);

		expect(replaces).toBe(2);
	});

	test("does not open duplicate alias dialogs for equivalent pending connections", async () => {
		await import("@opentui/solid/runtime-plugin" + "-support");
		const { createPendingConnection } = await import("../../src/core/pending");
		const { openAliasDialog } = await import(
			"../../src/tui/components/alias-dialog" + ".tsx"
		);
		const database = createDb();
		const auth = {
			access: "a",
			expires: 123,
			refresh: "r",
			type: "oauth" as const,
		};
		const first = createPendingConnection(
			database,
			"openai",
			auth,
			"auth-file",
		);
		database
			.query(
				`INSERT INTO pending_connections (
                     id, provider_id, auth_json, auth_type, source, captured_at, prompt_status
                 ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
			)
			.run(
				"legacy-duplicate",
				"openai",
				JSON.stringify(auth),
				"oauth",
				"auth-file",
				Date.now(),
				"new",
			);
		let replaces = 0;
		const api = {
			theme: { current: { textMuted: "muted" } },
			ui: {
				DialogPrompt: () => null,
				dialog: {
					clear: () => {},
					replace: (render: () => unknown) => {
						replaces++;
						return render();
					},
					setSize: () => {},
				},
				toast: () => {},
			},
		};
		const state = {
			db: database,
			pending: () => [
				{ authType: "oauth", id: first.id, providerID: "openai" },
				{ authType: "oauth", id: "legacy-duplicate", providerID: "openai" },
			],
			refresh: () => {},
		};

		openAliasDialog(api as never, state as never, first.id);
		openAliasDialog(api as never, state as never, "legacy-duplicate");

		expect(replaces).toBe(1);
	});

	test("does not open a dialog for a missing pending connection", async () => {
		await import("@opentui/solid/runtime-plugin" + "-support");
		const { openAliasDialog } = await import(
			"../../src/tui/components/alias-dialog" + ".tsx"
		);
		let replaces = 0;
		const api = {
			theme: { current: { textMuted: "muted" } },
			ui: {
				DialogPrompt: () => null,
				dialog: {
					clear: () => {},
					replace: (render: () => unknown) => {
						replaces++;
						return render();
					},
					setSize: () => {},
				},
				toast: () => {},
			},
		};
		const state = {
			db: createDb(),
			pending: () => [
				{ authType: "api", id: "pending-1", providerID: "openai" },
			],
			refresh: () => {},
		};

		openAliasDialog(api as never, state as never, "missing-pending");

		expect(replaces).toBe(0);
	});
});
