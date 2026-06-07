import { appendFileSync, readFileSync } from "node:fs";

export interface PackageMetadataOptions {
	outputPath?: string;
	packagePath?: string;
}

interface PackageJson {
	name?: string;
	version?: string;
}

function appendOutput(path: string, name: string, value: string) {
	appendFileSync(path, `${name}=${value}\n`);
}

export async function writePackageMetadata(
	options: PackageMetadataOptions = {},
) {
	const packagePath = options.packagePath ?? "package.json";
	const outputPath = options.outputPath ?? process.env.GITHUB_OUTPUT;

	if (!outputPath) throw new Error("GITHUB_OUTPUT is required");

	const packageJson = JSON.parse(
		readFileSync(packagePath, "utf8"),
	) as PackageJson;
	if (!packageJson.name) throw new Error(`${packagePath} is missing name`);
	if (!packageJson.version)
		throw new Error(`${packagePath} is missing version`);

	appendOutput(outputPath, "name", packageJson.name);
	appendOutput(outputPath, "version", packageJson.version);
	appendOutput(outputPath, "tag", `v${packageJson.version}`);
}

if (import.meta.main) await writePackageMetadata();
