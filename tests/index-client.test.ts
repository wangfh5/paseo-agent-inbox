import type { PluginClientContext } from "@getpaseo/plugin/client";
import { describe, expect, test, vi } from "vitest";
import contribute from "../index.client";

vi.mock("../client/inbox-screen", () => ({ InboxScreen: () => null }));
vi.mock("../client/settings-screen", () => ({ InboxSettingsScreen: () => null }));
vi.mock("../client/sidebar", () => ({ INBOX_SCREEN_ID: "inbox", InboxSidebarItem: () => null }));

function host() {
  const removed: string[] = [];
  const registered: string[] = [];
  const commands: Array<{ id: string; onSelect(capabilities: unknown): void }> = [];
  const register = (method: string) => (contribution: { id: string }) => {
    registered.push(`${method}:${contribution.id}`);
    return () => removed.push(`${method}:${contribution.id}`);
  };
  const client = {
    addSettingsScreen: register("addSettingsScreen"),
    addScreen: register("addScreen"),
    addSidebarHeaderItem: register("addSidebarHeaderItem"),
    addCommandCenterItem: (command: { id: string; onSelect(capabilities: unknown): void }) => {
      commands.push(command);
      return register("addCommandCenterItem")(command);
    },
  } as unknown as PluginClientContext;
  return { client, registered, removed, commands };
}

describe("client entry", () => {
  test("registers the inbox screen, sidebar row and commands, then removes all", () => {
    const { client, registered, removed } = host();
    const cleanup = contribute(client);
    expect(registered).toEqual([
      "addSettingsScreen:inbox",
      "addScreen:inbox",
      "addSidebarHeaderItem:inbox",
      "addCommandCenterItem:open-inbox",
      "addCommandCenterItem:configure-inbox",
    ]);
    cleanup();
    expect(removed.sort()).toEqual([...registered].sort());
  });

  test("Open agent inbox navigates to the screen", () => {
    const { client, commands } = host();
    contribute(client);
    const openScreen = vi.fn();
    commands.find(({ id }) => id === "open-inbox")?.onSelect({ openScreen });
    expect(openScreen).toHaveBeenCalledWith({ screenId: "inbox" });
  });
});
