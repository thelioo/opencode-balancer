import type { TuiPlugin } from "@opencode-ai/plugin/tui";
import { serverPlugin } from "./server/index";

const plugin = serverPlugin as typeof serverPlugin & {
	id: string;
	tui: TuiPlugin;
};
plugin.id = "opencode-balancer";
plugin.tui = async (...args) => {
	const module = (await import(
		new URL("./tui/tui.js", import.meta.url).href
	)) as {
		default: { tui: TuiPlugin };
	};
	return module.default.tui(...args);
};

export default plugin;
