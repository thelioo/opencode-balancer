import { rm } from "node:fs/promises";
import solidTransformPlugin from "@opentui/solid/bun-plugin";

await rm("dist", { force: true, recursive: true });

const result = await Bun.build({
	entrypoints: [
		"./src/index.ts",
		"./src/tui/tui.tsx",
		"./src/tui/db-worker.ts",
	],
	external: [
		"./components/*",
		"@opencode-ai/plugin",
		"@opencode-ai/plugin/*",
		"@opentui/core",
		"@opentui/core/*",
		"@opentui/solid",
		"@opentui/solid/*",
		"solid-js",
		"solid-js/*",
		"web-tree-sitter",
		"web-tree-sitter/*",
	],
	format: "esm",
	minify: true,
	naming: {
		entry: "[dir]/[name].[ext]",
	},
	outdir: "dist",
	plugins: [solidTransformPlugin],
	sourcemap: "external",
	target: "bun",
});

if (!result.success) {
	for (const log of result.logs) console.error(log);
	process.exit(1);
}

await import("./copy-tui-source");

for (const output of result.outputs) {
	if (!output.path.endsWith(".map")) continue;

	const sourceMap = (await output.json()) as { sourcesContent?: string[] };
	delete sourceMap.sourcesContent;
	await Bun.write(output.path, JSON.stringify(sourceMap));
}
