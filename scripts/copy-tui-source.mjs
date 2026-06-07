import { copyFileSync, mkdirSync, readdirSync, statSync } from "node:fs";
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
    }
}

copyTuiSource(sourceRoot, targetRoot);
