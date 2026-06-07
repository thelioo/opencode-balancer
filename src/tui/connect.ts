import type { Database } from "bun:sqlite";
import { listAccounts, saveAccount } from "../core/accounts";
import {
	clearNativeConnectInProgress,
	markNativeConnectInProgress,
} from "../core/native-connect";
import type { AuthInfo } from "../core/types";
import { readNativeAuth, sameSavedAuth } from "../server/auth-watcher";

type NativeAuthReadResult =
	| { ok: true; auth: Record<string, AuthInfo> }
	| { ok: false };

type ConnectApi = {
	db?: Database;
	readAuth?: () => NativeAuthReadResult;
	generateAlias?: () => string;
	wait?: (ms: number) => Promise<void>;
	maxWaitMs?: number;
	pollIntervalMs?: number;
	keymap?: {
		dispatchCommand?: (command: string) => unknown;
	};
	ui?: {
		dialog?: { open?: boolean };
		toast?: (input: {
			variant: "success" | "error";
			message: string;
		}) => unknown;
	};
};

const aliasAlphabet = "abcdefghijklmnopqrstuvwxyz0123456789";

function generatedAlias() {
	let alias = "";
	for (let index = 0; index < 5; index++)
		alias += aliasAlphabet[Math.floor(Math.random() * aliasAlphabet.length)];
	return alias;
}

function authKey(auth: AuthInfo | undefined) {
	return JSON.stringify(auth ?? null);
}

function changedProvider(
	before: Record<string, AuthInfo>,
	after: Record<string, AuthInfo>,
) {
	return Object.entries(after).find(
		([providerID, auth]) => authKey(before[providerID]) !== authKey(auth),
	);
}

function uniqueAlias(db: Database, providerID: string, generate: () => string) {
	for (let attempt = 0; attempt < 100; attempt++) {
		const alias = generate();
		const existing = db
			.query<{ alias: string }, [string, string]>(
				"SELECT alias FROM accounts WHERE provider_id = ? AND alias = ?",
			)
			.get(providerID, alias);
		if (!existing) return alias;
	}
	throw new Error("Could not generate a unique alias");
}

async function waitForChangedProvider(
	readAuth: () => NativeAuthReadResult,
	before: NativeAuthReadResult,
	options: {
		wait: (ms: number) => Promise<void>;
		maxWaitMs: number;
		pollIntervalMs: number;
	},
) {
	const started = Date.now();
	while (true) {
		const after = readAuth();
		if (before.ok && after.ok) {
			const changed = changedProvider(before.auth, after.auth);
			if (changed) return changed;
		}
		if (Date.now() - started >= options.maxWaitMs) return;
		await options.wait(options.pollIntervalMs);
	}
}

export async function openNativeConnect(api: ConnectApi) {
	if (api.keymap?.dispatchCommand) {
		const readAuth = api.readAuth ?? readNativeAuth;
		const before = readAuth();
		if (api.db) markNativeConnectInProgress(api.db);
		await api.keymap.dispatchCommand("provider.connect");
		if (api.db) {
			try {
				const changed = await waitForChangedProvider(readAuth, before, {
					maxWaitMs: api.maxWaitMs ?? (api.ui?.dialog ? 10 * 60 * 1000 : 0),
					pollIntervalMs: api.pollIntervalMs ?? 500,
					wait:
						api.wait ??
						((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
				});
				if (changed) {
					const [providerID, auth] = changed;
					const existing = listAccounts(api.db, providerID).find((candidate) =>
						sameSavedAuth(candidate.auth, auth),
					);
					const alias =
						existing?.alias ??
						uniqueAlias(
							api.db,
							providerID,
							api.generateAlias ?? generatedAlias,
						);
					const account = saveAccount(api.db, providerID, alias, auth);
					api.ui?.toast?.({
						message: `Saved ${account.providerID}/${account.alias}.`,
						variant: "success",
					});
				}
			} finally {
				clearNativeConnectInProgress(api.db);
			}
		}
		return;
	}

	api.ui?.toast?.({
		message: "Native provider connect is unavailable in this opencode build.",
		variant: "error",
	});
}
