import { tool, type Plugin } from "@opencode-ai/plugin";
import {
    BALANCER_METADATA_KEY,
    INTERNAL_REQUEST_HEADER,
    getActiveAccount,
    setNativeAuth,
    showToast,
    state,
} from "./balancer/core";
import { startAuthWatcher } from "./balancer/auth-watcher";
import { runBalancerCommand } from "./balancer/commands";
import { installFetchPatch } from "./balancer/fetch-patch";

export default (async ({ client }) => {
    await installFetchPatch(client);
    startAuthWatcher(client);

    return {
        config: async (cfg) => {
            cfg.command = {
                ...(cfg.command ?? {}),
                balancer: {
                    description: "Manage multiple accounts per provider",
                    template:
                        "Run the internal balancer command with these arguments: $ARGUMENTS",
                },
            };
        },

        "command.execute.before": async (input, output) => {
            if (input.command !== "balancer") return;
            const result = await runBalancerCommand(client, input.arguments);
            output.parts.length = 0;
            await showToast(client, result, "info");
            throw new Error(`[balancer]\n${result}`);
        },

        "experimental.chat.messages.transform": async (_input, output) => {
            output.messages = output.messages.filter((message) => {
                return !message.parts.some((part: any) => {
                    return part?.metadata?.[BALANCER_METADATA_KEY] === true;
                });
            });
        },

        "chat.headers": async (input, output) => {
            const providerID = input.model.providerID;
            const account = await getActiveAccount(providerID);
            if (!account) return;

            if (account.auth.type === "oauth")
                await setNativeAuth(client, providerID, account.auth);

            const requestID = crypto.randomUUID();
            state.pendingRequests.set(requestID, {
                providerID,
                account,
            });
            output.headers[INTERNAL_REQUEST_HEADER] = requestID;
        },

        tool: {
            balancer_command: tool({
                description:
                    "Run an opencode account balancer command. Use for managing provider account aliases.",
                args: {
                    command: tool.schema
                        .string()
                        .describe(
                            "Command, e.g. 'list', 'alias work', 'use anthropic personal'.",
                        ),
                },
                execute: async (args) =>
                    runBalancerCommand(client, args.command),
            }),
        },
    };
}) satisfies Plugin;
