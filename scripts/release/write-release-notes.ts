import { readFileSync, writeFileSync } from "node:fs";

export interface WriteReleaseNotesOptions {
	changelogPath?: string;
	outputPath?: string;
	packageVersion?: string;
}

export async function writeReleaseNotes(
	options: WriteReleaseNotesOptions = {},
) {
	const changelogPath = options.changelogPath ?? "CHANGELOG.md";
	const outputPath = options.outputPath ?? "release-notes.md";
	const packageVersion = options.packageVersion ?? process.env.PACKAGE_VERSION;

	if (!packageVersion) throw new Error("PACKAGE_VERSION is required");

	const changelog = readFileSync(changelogPath, "utf8");
	const heading = `## ${packageVersion}`;
	const lines = changelog.split(/\r?\n/);
	const start = lines.findIndex((line) => line.trim() === heading);

	if (start === -1)
		throw new Error(`Missing changelog entry for ${packageVersion}`);

	const end = lines.findIndex(
		(line, index) => index > start && line.startsWith("## "),
	);
	const notes = lines
		.slice(start + 1, end === -1 ? lines.length : end)
		.join("\n")
		.trim();

	if (!notes) throw new Error(`Empty changelog entry for ${packageVersion}`);

	writeFileSync(outputPath, `${notes}\n`);
}

if (import.meta.main) await writeReleaseNotes();
