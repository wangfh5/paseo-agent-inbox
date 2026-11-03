import type { PluginServerContext } from "@getpaseo/plugin/server";
import { inboxSettings } from "./shared/inbox-settings";
import { triageSettings } from "./shared/triage-settings";

export default function contribute(server: PluginServerContext) {
  server.registerSettings(inboxSettings);
  server.registerSettings(triageSettings);
  return () => {};
}
