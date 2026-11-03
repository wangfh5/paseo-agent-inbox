import type { PluginPopoverProps, PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { useMemo } from "react";
import { Pressable, Text, View } from "react-native";
import { requestAgentOpen } from "./focus-request";
import { activityAt, compareItems, type InboxItem, stateLabel } from "./inbox";
import { age, hostColor, title } from "./monitor";
import { useInbox } from "./use-inbox";

export const INBOX_SCREEN_ID = "inbox";
const POPOVER_LIMIT = 12;
const SIDEBAR_CLOCK_MS = 60_000;

function badgeLabel(summary: { count: number; lowerBound: boolean } | null): string | null {
  return summary && summary.count > 0 ? `${summary.count}${summary.lowerBound ? "+" : ""}` : null;
}

export function InboxSidebarItem({
  theme,
  currentScreen,
  openScreen,
  openPopover,
}: PluginSidebarItemProps) {
  const { summary } = useInbox(SIDEBAR_CLOCK_MS);
  const label = badgeLabel(summary);
  const styles = useMemo(
    () => ({
      badge: {
        minWidth: 20,
        height: 20,
        paddingHorizontal: 6,
        borderRadius: 10,
        alignItems: "center" as const,
        justifyContent: "center" as const,
        backgroundColor: theme.colors.accent,
      },
      badgeText: { color: theme.colors.accentForeground, fontSize: 11, fontWeight: "600" as const },
    }),
    [theme],
  );
  return (
    <SidebarRow
      icon="Inbox"
      label="Agent inbox"
      active={currentScreen?.screenId === INBOX_SCREEN_ID}
      onPress={() => openScreen({ screenId: INBOX_SCREEN_ID })}
      trailing={
        label ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${label} agents need attention`}
            onPress={() => openPopover(AttentionPopover)}
            style={styles.badge}
          >
            <Text style={styles.badgeText}>{label}</Text>
          </Pressable>
        ) : null
      }
    />
  );
}

function openAgent(openScreen: PluginPopoverProps["openScreen"], item: InboxItem): void {
  const token = String(Date.now());
  requestAgentOpen({ agentId: item.entry.agent.id, serverId: item.host?.serverId, token });
  openScreen({ screenId: INBOX_SCREEN_ID, params: { openAgent: token } });
}

/** The attention queue, from the same derivation as the badge and the screen. */
function AttentionPopover({ theme, layout, openScreen, close }: PluginPopoverProps) {
  const { items, summary, now } = useInbox(SIDEBAR_CLOCK_MS);
  const queue = useMemo(
    () =>
      (items ?? [])
        .filter((item) => item.needsAttention)
        .sort((l, r) => compareItems(l, r, "updated")),
    [items],
  );
  const shown = queue.slice(0, POPOVER_LIMIT);
  const styles = useMemo(
    () => ({
      root: { gap: layout.compact ? 8 : 4, minWidth: 300 },
      heading: { color: theme.colors.foreground, fontSize: 13, fontWeight: "600" as const },
      detail: { color: theme.colors.foregroundMuted, fontSize: 12 },
      row: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 8,
        paddingVertical: 4,
      },
      rowBody: { flex: 1, gap: 1 },
      rowTitle: { color: theme.colors.foreground, fontSize: 13 },
      action: {
        minHeight: 32,
        justifyContent: "center" as const,
        paddingHorizontal: 12,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: theme.colors.border,
        marginTop: 4,
      },
      actionText: { color: theme.colors.foreground, fontSize: 13 },
    }),
    [theme, layout.compact],
  );
  const label = badgeLabel(summary);
  return (
    <View style={styles.root}>
      <Text style={styles.heading}>
        {summary === null
          ? "Checking agents…"
          : label
            ? `${label} need attention`
            : "Nothing needs attention"}
      </Text>
      {shown.map((item) => {
        const color = item.host ? hostColor(item.host) : theme.colors.foregroundMuted;
        return (
          <Pressable
            key={item.key}
            accessibilityRole="button"
            accessibilityLabel={`Open ${title(item.entry)}`}
            onPress={() => openAgent(openScreen, item)}
            style={({ pressed }) => [styles.row, pressed ? { opacity: 0.6 } : null]}
          >
            <View
              style={{
                width: 8,
                height: 8,
                borderRadius: 4,
                backgroundColor: theme.colors.statusWarning,
              }}
            />
            <View style={styles.rowBody}>
              <Text style={styles.rowTitle} numberOfLines={1}>
                {title(item.entry)}
              </Text>
              <Text style={styles.detail} numberOfLines={1}>
                {item.host ? <Text style={{ color }}>{item.host.label} · </Text> : null}
                {stateLabel(item)} · {age(activityAt(item), now)}
              </Text>
            </View>
          </Pressable>
        );
      })}
      {queue.length > shown.length ? (
        <Text style={styles.detail}>and {queue.length - shown.length} more</Text>
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Open agent inbox"
        onPress={() => {
          close();
          openScreen({ screenId: INBOX_SCREEN_ID, params: { view: "attention" } });
        }}
        style={styles.action}
      >
        <Text style={styles.actionText}>Open inbox</Text>
      </Pressable>
    </View>
  );
}
