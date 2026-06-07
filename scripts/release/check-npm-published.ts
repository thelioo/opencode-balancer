import { appendFileSync } from "node:fs";

export type CommandRunner = (command: string[]) => Promise<number>;

export interface CheckNpmPublishedOptions {
	outputPath?: string;
	packageName?: string;
	packageVersion?: string;
	run?: CommandRunner;
}

function appendOutput(path: string, name: string, value: string) {
	appendFileSync(path, `${name}=${value}\n`);
}

async function runCommand(command: string[]) {
	const proc = Bun.spawn(command, { stderr: "ignore", stdout: "ignore" });
	return await proc.exited;
}

export async function checkNpmPublished(
	options: CheckNpmPublishedOptions = {},
) {
	const outputPath = options.outputPath ?? process.env.GITHUB_OUTPUT;
	const packageName = options.packageName ?? process.env.PACKAGE_NAME;
	const packageVersion = options.packageVersion ?? process.env.PACKAGE_VERSION;
	const run = options.run ?? runCommand;

	if (!outputPath) throw new Error("GITHUB_OUTPUT is required");
	if (!packageName) throw new Error("PACKAGE_NAME is required");
	if (!packageVersion) throw new Error("PACKAGE_VERSION is required");

	const exitCode = await run([
		"npm",
		"view",
		`${packageName}@${packageVersion}`,
		"version",
	]);
	appendOutput(outputPath, "is_published", String(exitCode === 0));
}

if (import.meta.main) await checkNpmPublished();
