import type { PluginClientContext, PluginScreenProps } from "@getpaseo/plugin/client";
import { InboxScreen } from "./client/inbox-screen";
import { InboxSettingsScreen } from "./client/settings-screen";
import { INBOX_SCREEN_ID, InboxSidebarItem } from "./client/sidebar";

export default function contribute(client: PluginClientContext) {
  const removeSettings = client.addSettingsScreen({
    id: "inbox",
    title: "Inbox settings",
    icon: "Settings",
    Component: InboxSettingsScreen,
  });
  const removeScreen = client.addScreen({
    id: INBOX_SCREEN_ID,
    title: "Agent inbox",
    // biome-ignore lint/correctness/noComponentHookFactories: created once per installation, not per render; it closes over `client.openSettings`.
    Component: (props: PluginScreenProps) => (
      <InboxScreen
        {...props}
        viewParam={props.params.view}
        openAgentToken={props.params.openAgent}
        onOpenSettings={() => client.openSettings("inbox")}
      />
    ),
  });
  const removeSidebarItem = client.addSidebarHeaderItem({
    id: "inbox",
    title: "Agent inbox",
    Component: InboxSidebarItem,
  });
  const removeOpenInbox = client.addCommandCenterItem({
    id: "open-inbox",
    title: "Open agent inbox",
    icon: "Inbox",
    keywords: ["agents", "sessions", "inbox", "attention", "triage"],
    context: "global",
    onSelect({ openScreen }) {
      openScreen({ screenId: INBOX_SCREEN_ID });
    },
  });
  const removeConfigure = client.addCommandCenterItem({
    id: "configure-inbox",
    title: "Configure agent inbox",
    icon: "Settings",
    keywords: ["settings", "preferences", "inbox", "subagents"],
    context: "global",
    onSelect({ openSettings }) {
      openSettings("inbox");
    },
  });

  return () => {
    removeConfigure();
    removeOpenInbox();
    removeSidebarItem();
    removeScreen();
    removeSettings();
  };
}
