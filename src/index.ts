import { serverPlugin } from "./server/index";
import tuiModule from "./tui/tui";

const plugin = serverPlugin as typeof serverPlugin & {
	id: string;
	tui: typeof tuiModule.tui;
};
plugin.id = "opencode-balancer";
plugin.tui = tuiModule.tui;

export default plugin;
