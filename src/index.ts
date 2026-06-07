import { serverPlugin } from "./server/index";
import tuiModule from "./tui/tui";

export default Object.assign(serverPlugin, tuiModule);
