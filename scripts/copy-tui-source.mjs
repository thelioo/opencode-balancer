import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const sourceRoot = join(root, "src", "tui");
const targetRoot = join(root, "dist", "tui");

function copyTuiSource(sourceDir, targetDir) {
    mkdirSync(targetDir, { recursive: true });

    for (const entry of readdirSync(sourceDir)) {
        const sourcePath = join(sourceDir, entry);
        const targetPath = join(targetDir, entry);
        const stats = statSync(sourcePath);

        if (stats.isDirectory()) {
            copyTuiSource(sourcePath, targetPath);
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

function rmGeneratedFile(path) {
    if (existsSync(path)) rmSync(path);
}

copyTuiSource(sourceRoot, targetRoot);
