export type CommandRunner = (command: string[]) => Promise<number>;

export interface EnsureTagOptions {
	releaseTag?: string;
	run?: CommandRunner;
}

async function runCommand(command: string[]) {
	const proc = Bun.spawn(command, { stderr: "inherit", stdout: "inherit" });
	return await proc.exited;
}

async function mustRun(run: CommandRunner, command: string[]) {
	const exitCode = await run(command);
	if (exitCode !== 0) throw new Error(`Command failed: ${command.join(" ")}`);
}

export async function ensureTag(options: EnsureTagOptions = {}) {
	const releaseTag = options.releaseTag ?? process.env.RELEASE_TAG;
	const run = options.run ?? runCommand;

	if (!releaseTag) throw new Error("RELEASE_TAG is required");

	await mustRun(run, ["git", "config", "user.name", "github-actions[bot]"]);
	await mustRun(run, [
		"git",
		"config",
		"user.email",
		"41898282+github-actions[bot]@users.noreply.github.com",
	]);

	const tagExists = (await run(["git", "rev-parse", releaseTag])) === 0;
	if (!tagExists)
		await mustRun(run, ["git", "tag", "-a", releaseTag, "-m", releaseTag]);
}

if (import.meta.main) await ensureTag();
