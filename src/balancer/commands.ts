import {
    isAuthInfo,
    listAccountsText,
    normalizeAlias,
    readNativeAuth,
    readStore,
    saveAccount,
    setNativeAuth,
    storePath,
    writeStore,
} from "./core";

function parseArgs(input: string) {
    return (
        input
            .match(/(?:[^\s"]+|"[^"]*")+/g)
            ?.map((x) => x.replace(/^"|"$/g, "")) ?? []
    );
}

export async function runBalancerCommand(client: any, raw: string) {
    const [action = "help", ...args] = parseArgs(raw);
    const store = await readStore();

    if (["help", "--help", "-h"].includes(action)) {
        return [
            "Balancer commands:",
            "",
            "  /balancer alias <name>",
            "    saves the last detected connection",
            "    with an alias",
            "",
            "  /balancer save <provider> <name>",
            "    saves the provider's current credentials",
            "",
            "  /balancer use <provider> <name>",
            "    switches the active account",
            "",
            "  /balancer list",
            "    lists accounts",
            "",
            "  /balancer status",
            "    shows current state",
            "",
            "  /balancer remove <provider> <name>",
            "    removes an account",
        ].join("\n");
    }

    if (action === "alias") {
        const alias = args[0];
        if (!alias) return "Usage: /balancer alias <name>";
        const captured = store.lastCaptured;
        if (!captured)
            return "No connection detected yet. Run /connect <provider> first.";
        const account = await saveAccount(
            captured.providerID,
            alias,
            captured.auth,
        );
        await setNativeAuth(client, captured.providerID, captured.auth);
        return `Account saved and activated: ${captured.providerID}/${account.alias}`;
    }

    if (action === "save") {
        const [providerID, alias] = args;
        if (!providerID || !alias)
            return "Usage: /balancer save <provider> <name>";
        const auth = (await readNativeAuth())[providerID];
        if (!isAuthInfo(auth))
            return `No native credentials found for ${providerID}. Run /connect ${providerID} first.`;
        const account = await saveAccount(providerID, alias, auth);
        return `Account saved and activated: ${providerID}/${account.alias}`;
    }

    if (action === "use") {
        const [providerID, aliasInput] = args;
        const alias = normalizeAlias(aliasInput ?? "");
        if (!providerID || !alias)
            return "Usage: /balancer use <provider> <name>";
        const account = store.providers[providerID]?.accounts[alias];
        if (!account) return `Account not found: ${providerID}/${alias}`;
        store.providers[providerID].active = alias;
        await writeStore(store);
        await setNativeAuth(client, providerID, account.auth);
        return `Active account changed to ${providerID}/${alias}`;
    }

    if (action === "list" || action === "accounts") return listAccountsText();

    if (action === "status") {
        const last = store.lastCaptured;
        const lines = [await listAccountsText()];
        if (last)
            lines.push(
                "",
                `Last capture: ${last.providerID} via ${last.source} at ${new Date(last.capturedAt).toLocaleString()}`,
            );
        lines.push("", `Storage: ${storePath()}`);
        return lines.join("\n");
    }

    if (action === "remove") {
        const [providerID, aliasInput] = args;
        const alias = normalizeAlias(aliasInput ?? "");
        if (!providerID || !alias)
            return "Usage: /balancer remove <provider> <name>";
        const provider = store.providers[providerID];
        if (!provider?.accounts[alias])
            return `Account not found: ${providerID}/${alias}`;
        delete provider.accounts[alias];
        if (provider.active === alias)
            provider.active = Object.keys(provider.accounts)[0];
        await writeStore(store);
        return `Account removed: ${providerID}/${alias}`;
    }

    return `Unknown command: ${action}. Use /balancer help.`;
}
