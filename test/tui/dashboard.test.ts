import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const compact = (source: string) => source.replace(/\s+/g, "");
const expectSourceToContain = (source: string, snippet: string) =>
	expect(compact(source)).toContain(compact(snippet));

describe("Dashboard", () => {
	test("renders new account as an accounts row instead of a header action", () => {
		const source = readFileSync(
			join(import.meta.dir, "../../src/tui/components/dashboard.tsx"),
			"utf8",
		);

		expect(source).toContain('type: "connect"');
		expect(source).toContain("New account");
		expectSourceToContain(
			source,
			'<SectionTitle count={accounts().length} label="ACCOUNTS" />',
		);
		expect(source).toContain("props.openConnect");
		expect(source).not.toContain('<SectionTitle label="CONNECTIONS" />');
		expect(source).not.toContain('label: "connect"');
	});

	test("mutes account usage bars unless their account row is selected", () => {
		const source = readFileSync(
			join(import.meta.dir, "../../src/tui/components/dashboard.tsx"),
			"utf8",
		);

		expectSourceToContain(source, "muted={!selected(");
		expect(source).toContain(
			"`account:${account.providerID}/${account.alias}`",
		);
	});

	test("offers account rename from the dashboard", () => {
		const source = readFileSync(
			join(import.meta.dir, "../../src/tui/components/dashboard.tsx"),
			"utf8",
		);

		expect(source).toContain("props.renameAccount");
		expect(source).toContain("R to rename");
	});

	test("does not render pending auth rows", () => {
		const source = readFileSync(
			join(import.meta.dir, "../../src/tui/components/dashboard.tsx"),
			"utf8",
		);

		expect(source).not.toContain("PENDING AUTH");
		expect(source).not.toContain("pending auth");
		expect(source).not.toContain("listPendingConnections");
	});

	test("does not handle dashboard keys while a native dialog is open", () => {
		const source = readFileSync(
			join(import.meta.dir, "../../src/tui/components/dashboard.tsx"),
			"utf8",
		);

		expect(source).toContain("if (props.api.ui.dialog.open) return;");
	});
});
