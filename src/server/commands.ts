import type { Database } from "bun:sqlite";
import { getActiveAccount, listAccounts, setActiveAccount } from "../core/accounts";
import { listPendingConnections } from "../core/pending";

function parseArgs(input: string) {
    return input.match(/(?:[^\s"]+|"[^"]*")+/g)?.map((x) => x.replace(/^"|"$/g, "")) ?? [];
}

export function runFallbackBalancerCommand(db: Database, raw: string) {
    const [action = "help", ...args] = parseArgs(raw);

    if (["help", "--help", "-h"].includes(action)) {
        return [
            "Balancer is TUI-first. Use fallback commands only for compatibility or troubleshooting.",
            "Fallback commands: list, status, use <provider> <alias>, active <provider>.",
        ].join("\n");
    }

    if (action === "list") {
        const accounts = listAccounts(db);
        if (accounts.length === 0) return "No accounts saved.";
        return accounts.map((account) => `${account.providerID}/${account.alias}`).join("\n");
    }

    if (action === "status") {
        return `accounts=${listAccounts(db).length} pending=${listPendingConnections(db).length}`;
    }

    if (action === "use") {
        const [providerID, alias] = args;
        if (!providerID || !alias) return "Usage: /balancer use <provider> <alias>";
        try {
            const account = setActiveAccount(db, providerID, alias);
            return `Active account changed to ${providerID}/${account.alias}`;
        } catch (error) {
            return error instanceof Error ? error.message : "Account not found.";
        }
    }

    if (action === "active") {
        const [providerID] = args;
        if (!providerID) return "Usage: /balancer active <provider>";
        const account = getActiveAccount(db, providerID);
        if (!account) return "No active account for provider.";
        return `${providerID}/${account.alias}`;
    }

    return `Unknown command: ${action}. Use /balancer help.`;
}
