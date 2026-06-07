export type CommandRunner = (command: string[]) => Promise<number>;

export interface PushReleaseRefsOptions {
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

export async function pushReleaseRefs(options: PushReleaseRefsOptions = {}) {
	const releaseTag = options.releaseTag ?? process.env.RELEASE_TAG;
	const run = options.run ?? runCommand;

	if (!releaseTag) throw new Error("RELEASE_TAG is required");

	await mustRun(run, ["git", "push", "origin", "HEAD:main"]);

	const remoteTagExists =
		(await run([
			"git",
			"ls-remote",
			"--exit-code",
			"--tags",
			"origin",
			`refs/tags/${releaseTag}`,
		])) === 0;

	if (!remoteTagExists)
		await mustRun(run, ["git", "push", "origin", `refs/tags/${releaseTag}`]);
}

if (import.meta.main) await pushReleaseRefs();
