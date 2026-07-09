import {
	copyFileSync,
	existsSync,
	mkdirSync,
	readdirSync,
	rmSync,
	statSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const coreSourceRoot = join(root, "src", "core");
const coreTargetRoot = join(root, "dist", "core");
const serverSourceRoot = join(root, "src", "server");
const serverTargetRoot = join(root, "dist", "server");
const tuiSourceRoot = join(root, "src", "tui");
const tuiTargetRoot = join(root, "dist", "tui");

function copySource(sourceDir: string, targetDir: string) {
	mkdirSync(targetDir, { recursive: true });

	for (const entry of readdirSync(sourceDir)) {
		const sourcePath = join(sourceDir, entry);
		const targetPath = join(targetDir, entry);
		const stats = statSync(sourcePath);

		if (stats.isDirectory()) {
			copySource(sourcePath, targetPath);
			continue;
		}

		if (!/\.tsx?$/.test(entry)) continue;
		mkdirSync(dirname(targetPath), { recursive: true });
		copyFileSync(sourcePath, targetPath);

		if (/\.tsx$/.test(entry) && entry !== "tui.tsx") {
			rmGeneratedFile(targetPath.replace(/\.tsx$/, ".js"));
			rmGeneratedFile(targetPath.replace(/\.tsx$/, ".js.map"));
		}
	}
}

function rmGeneratedFile(path: string) {
	if (existsSync(path)) rmSync(path);
}

copySource(coreSourceRoot, coreTargetRoot);
copySource(serverSourceRoot, serverTargetRoot);
copySource(tuiSourceRoot, tuiTargetRoot);
