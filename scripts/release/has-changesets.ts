import { appendFileSync, existsSync, readdirSync } from "node:fs";

export interface HasChangesetsOptions {
	changesetDir?: string;
	outputPath?: string;
}

function appendOutput(path: string, name: string, value: string) {
	appendFileSync(path, `${name}=${value}\n`);
}

export async function hasChangesets(options: HasChangesetsOptions = {}) {
	const changesetDir = options.changesetDir ?? ".changeset";
	const outputPath = options.outputPath ?? process.env.GITHUB_OUTPUT;

	if (!outputPath) throw new Error("GITHUB_OUTPUT is required");

	const hasPendingChangeset =
		existsSync(changesetDir) &&
		readdirSync(changesetDir).some(
			(entry) => entry.endsWith(".md") && entry !== "README.md",
		);

	appendOutput(outputPath, "has_changesets", String(hasPendingChangeset));
}

if (import.meta.main) await hasChangesets();
