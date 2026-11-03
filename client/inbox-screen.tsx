import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/ui";
import { useCallback, useLayoutEffect, useMemo, useState } from "react";
import { FlatList, Pressable, Text, TextInput, View } from "react-native";
import { type AgentSort, type InboxSettings, SORT_OPTIONS } from "../shared/inbox-settings";
import { peekAgentOpen, takeAgentOpen } from "./focus-request";
import {
  activityAt,
  countViews,
  filterItems,
  formatWake,
  type InboxItem,
  type InboxRow,
  type InboxView,
  onHost,
  orderRows,
  stateLabel,
  VIEWS,
} from "./inbox";
import { age, delegatedFromServerId, type HostScope, hostColor, placement, title } from "./monitor";
import {
  SNOOZE_PRESETS,
  type SnoozePreset,
  settleRecord,
  snoozeRecord,
  snoozeUntil,
} from "./triage";
import { useInbox } from "./use-inbox";

const CLOCK_INTERVAL_MS = 15_000;

type InboxScreenProps = PluginSurfaceProps & {
  onOpenSettings(): void;
  /** The screen's `view` param: one of the view ids; anything else uses the default view. */
  viewParam?: string;
  /** A nonce the sidebar popover sends when it opens this screen to hand off to an agent. */
  openAgentToken?: string;
};

export function parseViewParam(value: string | undefined): InboxView | undefined {
  return VIEWS.find((view) => view.id === value)?.id;
}

export function InboxScreen(props: InboxScreenProps) {
  // Hand off to the agent's native chat when the sidebar popover asked for it. Deferred past this
  // commit: a navigate dispatched while the pushed route is still committing is dropped.
  useLayoutEffect(() => {
    const pending = peekAgentOpen();
    if (!pending || pending.token !== props.openAgentToken) return;
    const handoff = setTimeout(() => {
      const request = peekAgentOpen();
      if (!request || request.token !== props.openAgentToken) return;
      takeAgentOpen();
      props.navigation?.openAgent({ agentId: request.agentId, serverId: request.serverId });
    }, 0);
    return () => clearTimeout(handoff);
  }, [props.navigation, props.openAgentToken]);

  const inbox = useInbox(CLOCK_INTERVAL_MS);
  if (!inbox.settings) {
    return (
      <View style={{ flex: 1, padding: 24, backgroundColor: props.theme.colors.surface0 }}>
        <Text style={{ color: props.theme.colors.foregroundMuted }}>Loading inbox…</Text>
      </View>
    );
  }
  return <InboxList {...props} inbox={inbox} settings={inbox.settings} />;
}

function InboxList({
  theme,
  layout,
  navigation,
  onOpenSettings,
  viewParam,
  inbox,
  settings,
}: InboxScreenProps & { inbox: ReturnType<typeof useInbox>; settings: InboxSettings }) {
  const { monitor, triage, now, prefs } = inbox;
  const { hosts, failedHosts, truncated } = monitor;
  const multiHost = hosts.length > 1;
  const [view, setView] = useState<InboxView>(
    () => parseViewParam(viewParam) ?? settings.defaultView,
  );
  const [hostSelected, setHostSelected] = useState<string | null>(null);
  const [needle, setNeedle] = useState("");
  const [snoozeMenu, setSnoozeMenu] = useState<string | null>(null);

  const scoped = useMemo(
    () => onHost(inbox.items ?? [], hostSelected),
    [inbox.items, hostSelected],
  );
  const counts = useMemo(() => countViews(scoped), [scoped]);
  const rows = useMemo(
    () => orderRows(filterItems(scoped, view, needle), settings.agentSort),
    [needle, scoped, settings.agentSort, view],
  );

  const setSort = useCallback(
    (agentSort: AgentSort) => {
      if (prefs.status === "ready" && !prefs.saving) {
        void prefs.save({ ...prefs.values, agentSort }, prefs.revision);
      }
    },
    [prefs],
  );
  const settle = useCallback(
    (item: InboxItem) =>
      triage.apply({
        type: "set",
        key: item.key,
        record: settleRecord(item.entry.agent, Date.now()),
      }),
    [triage],
  );
  const snooze = useCallback(
    (item: InboxItem, preset: SnoozePreset) => {
      const at = Date.now();
      setSnoozeMenu(null);
      triage.apply({
        type: "set",
        key: item.key,
        record: snoozeRecord(item.entry.agent, at, snoozeUntil(preset, at)),
      });
    },
    [triage],
  );
  const restore = useCallback(
    (item: InboxItem) => triage.apply({ type: "delete", key: item.key }),
    [triage],
  );

  const styles = useMemo(() => {
    const gutter = layout.compact ? 12 : 20;
    const muted = theme.colors.foregroundMuted;
    const border = theme.colors.border;
    const chip = {
      minHeight: 28,
      paddingHorizontal: 9,
      borderRadius: 6,
      borderWidth: 1,
      justifyContent: "center" as const,
    };
    const button = {
      minHeight: 26,
      paddingHorizontal: 8,
      borderRadius: 6,
      borderWidth: 1,
      borderColor: border,
      justifyContent: "center" as const,
    };
    return {
      screen: { flex: 1, backgroundColor: theme.colors.surface0 },
      header: { paddingHorizontal: gutter, paddingTop: gutter, paddingBottom: 8, gap: 8 },
      summaryLine: { flexDirection: "row" as const, alignItems: "center" as const, gap: 8 },
      summary: { flex: 1, color: muted, fontSize: 13 },
      syncing: { color: muted, fontSize: 11 },
      syncingHidden: { opacity: 0 },
      chips: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: 6 },
      chip: { ...chip, borderColor: border },
      chipOn: { ...chip, borderColor: theme.colors.accent, backgroundColor: theme.colors.accent },
      chipText: { color: muted, fontSize: 12 },
      chipTextOn: { color: theme.colors.accentForeground, fontSize: 12 },
      label: { color: muted, fontSize: 11, alignSelf: "center" as const, marginRight: 2 },
      search: {
        color: theme.colors.foreground,
        borderRadius: 6,
        paddingVertical: 7,
        paddingHorizontal: 10,
        borderWidth: 1,
        borderColor: border,
        fontSize: 13,
      },
      iconButton: {
        width: 28,
        height: 28,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: border,
        alignItems: "center" as const,
        justifyContent: "center" as const,
      },
      row: {
        paddingRight: gutter,
        paddingVertical: 7,
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 8,
      },
      rowMain: { flex: 1, flexDirection: "row" as const, alignItems: "center" as const, gap: 10 },
      pressed: { opacity: 0.6 },
      dot: { width: 8, height: 8, borderRadius: 4 },
      rowBody: { flex: 1, gap: 2 },
      titleLine: { flexDirection: "row" as const, alignItems: "center" as const, gap: 6 },
      rowTitle: { flexShrink: 1, color: theme.colors.foreground, fontSize: 14 },
      rowMeta: { color: muted, fontSize: 12 },
      tag: { color: muted, fontSize: 11 },
      hostPill: { paddingHorizontal: 6, paddingVertical: 1, borderRadius: 7, borderWidth: 1 },
      rowStatus: { color: muted, fontSize: 12, fontVariant: ["tabular-nums" as const] },
      actions: { flexDirection: "row" as const, alignItems: "center" as const, gap: 6 },
      button,
      buttonText: { color: theme.colors.foreground, fontSize: 12 },
      menu: {
        flexDirection: "row" as const,
        flexWrap: "wrap" as const,
        gap: 6,
        paddingRight: gutter,
        paddingBottom: 8,
        alignItems: "center" as const,
      },
      separator: { height: 1, backgroundColor: border },
      empty: { padding: gutter, color: muted },
      error: { paddingHorizontal: gutter, paddingBottom: 6, color: theme.colors.statusDanger },
      gutter,
    };
  }, [layout.compact, theme]);

  const hostPill = useCallback(
    (host: HostScope) => {
      const color = hostColor(host);
      return (
        <View
          accessibilityLabel={`Host ${host.label}`}
          style={[styles.hostPill, { borderColor: `${color}66`, backgroundColor: `${color}26` }]}
        >
          <Text style={{ color, fontSize: 10, fontWeight: "700" }}>{host.label}</Text>
        </View>
      );
    },
    [styles],
  );

  const renderRow = useCallback(
    ({ item: row }: { item: InboxRow }) => {
      const { item, depth } = row;
      const { agent } = item.entry;
      const name = title(item.entry);
      const dotColor =
        item.needsAttention && (agent.status === "error" || agent.attentionReason === "error")
          ? theme.colors.statusDanger
          : item.needsAttention
            ? theme.colors.statusWarning
            : item.base === "running"
              ? theme.colors.statusSuccess
              : theme.colors.foregroundMuted;
      const status =
        item.base === "running"
          ? stateLabel(item)
          : `${stateLabel(item)} · ${age(activityAt(item), now)}`;
      const record = triage.records?.[item.key];
      const triageTag =
        item.triage === "settled"
          ? "settled"
          : item.triage === "snoozed" && record?.until
            ? `snoozed until ${formatWake(Date.parse(record.until), now)}`
            : null;
      const delegatedFrom = item.host ? delegatedFromServerId(agent, item.host.serverId) : null;
      const delegatedLabel = delegatedFrom
        ? (hosts.find((host) => host.serverId === delegatedFrom)?.label ?? delegatedFrom)
        : null;
      const meta = [
        settings.showPlacement ? placement(item.entry) : null,
        depth === 0 && item.parentKey ? "subagent" : null,
        delegatedLabel ? `from ${delegatedLabel}` : null,
      ]
        .filter(Boolean)
        .join(" · ");
      const indent = styles.gutter + depth * 18;
      const body = (
        <>
          <View style={[styles.dot, { backgroundColor: dotColor }]} />
          <View style={styles.rowBody}>
            <View style={styles.titleLine}>
              <Text style={styles.rowTitle} numberOfLines={1} ellipsizeMode="tail">
                {name}
              </Text>
              {item.subagents > 0 && !settings.showSubagents ? (
                <Text style={styles.tag}>+{item.subagents} sub</Text>
              ) : null}
              {triageTag ? <Text style={styles.tag}>{triageTag}</Text> : null}
            </View>
            {multiHost || meta ? (
              <View style={styles.titleLine}>
                {multiHost && item.host ? hostPill(item.host) : null}
                {meta ? (
                  <Text style={[styles.rowMeta, { flexShrink: 1 }]} numberOfLines={1}>
                    {meta}
                  </Text>
                ) : null}
              </View>
            ) : null}
          </View>
        </>
      );
      const actionButton = (label: string, onPress: () => void) => (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${label} ${name}`}
          hitSlop={4}
          onPress={onPress}
          style={({ pressed }) => [styles.button, pressed && styles.pressed]}
        >
          <Text style={styles.buttonText}>{label}</Text>
        </Pressable>
      );
      return (
        <View>
          <View
            style={[
              styles.row,
              { paddingLeft: indent },
              depth > 0 ? { borderLeftWidth: 2, borderLeftColor: theme.colors.border } : null,
            ]}
          >
            {navigation ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Open agent ${name}`}
                onPress={() =>
                  navigation.openAgent({
                    agentId: agent.id,
                    ...(item.host ? { serverId: item.host.serverId } : null),
                  })
                }
                style={({ pressed }) => [styles.rowMain, pressed && styles.pressed]}
              >
                {body}
              </Pressable>
            ) : (
              <View style={styles.rowMain}>{body}</View>
            )}
            <Text style={styles.rowStatus}>{status}</Text>
            <View style={styles.actions}>
              {item.needsAttention ? (
                <>
                  {actionButton("Settle", () => settle(item))}
                  {actionButton("Snooze", () =>
                    setSnoozeMenu((current) => (current === item.key ? null : item.key)),
                  )}
                </>
              ) : null}
              {item.triage === "settled" ? actionButton("Undo settle", () => restore(item)) : null}
              {item.triage === "snoozed" ? actionButton("Unsnooze", () => restore(item)) : null}
            </View>
          </View>
          {snoozeMenu === item.key && item.needsAttention ? (
            <View style={[styles.menu, { paddingLeft: indent + 18 }]}>
              <Text style={styles.label}>Snooze until</Text>
              {SNOOZE_PRESETS.map((preset) => (
                <Pressable
                  key={preset.id}
                  accessibilityRole="button"
                  accessibilityLabel={`Snooze ${name} for ${preset.label}`}
                  onPress={() => snooze(item, preset.id)}
                  style={({ pressed }) => [styles.button, pressed && styles.pressed]}
                >
                  <Text style={styles.buttonText}>
                    {preset.label} ({formatWake(snoozeUntil(preset.id, now), now)})
                  </Text>
                </Pressable>
              ))}
              {actionButton("Cancel", () => setSnoozeMenu(null))}
            </View>
          ) : null}
        </View>
      );
    },
    [
      hostPill,
      hosts,
      multiHost,
      navigation,
      now,
      restore,
      settings,
      settle,
      snooze,
      snoozeMenu,
      styles,
      theme,
      triage.records,
    ],
  );

  const chip = (key: string, label: string, active: boolean, onPress: () => void) => (
    <Pressable
      key={key}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={active ? styles.chipOn : styles.chip}
    >
      <Text style={active ? styles.chipTextOn : styles.chipText}>{label}</Text>
    </Pressable>
  );
  const separator = useCallback(() => <View style={styles.separator} />, [styles]);
  const hostSummary = multiHost ? `${hosts.length} hosts` : (hosts[0]?.label ?? "no hosts online");

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <View style={styles.summaryLine}>
          <Text style={styles.summary} numberOfLines={1}>
            {counts.all}
            {truncated ? "+" : ""} {settings.showSubagents ? "agents" : "top-level agents"} on{" "}
            {hostSummary}
          </Text>
          <Text style={[styles.syncing, monitor.isFetching ? null : styles.syncingHidden]}>
            syncing
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Refresh agents"
            onPress={monitor.refetchAll}
            style={styles.iconButton}
          >
            <Icon name="RefreshCw" size={14} color={theme.colors.foregroundMuted} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open inbox settings"
            onPress={onOpenSettings}
            style={styles.iconButton}
          >
            <Icon name="Settings" size={14} color={theme.colors.foregroundMuted} />
          </Pressable>
        </View>
        <View style={styles.chips}>
          {VIEWS.filter(
            ({ id }) => (id !== "settled" && id !== "snoozed") || counts[id] > 0 || view === id,
          ).map(({ id, label }) =>
            chip(id, `${label} ${counts[id]}`, view === id, () => setView(id)),
          )}
        </View>
        {multiHost ? (
          <View style={styles.chips}>
            {chip("all-hosts", "All hosts", hostSelected === null, () => setHostSelected(null))}
            {hosts.map((host) =>
              chip(host.serverId, host.label, hostSelected === host.serverId, () =>
                setHostSelected(hostSelected === host.serverId ? null : host.serverId),
              ),
            )}
          </View>
        ) : null}
        <View style={styles.chips}>
          <Text style={styles.label}>Sort</Text>
          {SORT_OPTIONS.map((option) =>
            chip(`sort-${option.id}`, option.label, settings.agentSort === option.id, () =>
              setSort(option.id),
            ),
          )}
        </View>
        <TextInput
          style={styles.search}
          value={needle}
          onChangeText={setNeedle}
          placeholder="Search title, host, project, path, model"
          placeholderTextColor={theme.colors.foregroundMuted}
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel="Search agents"
        />
      </View>
      {failedHosts.length > 0 ? (
        <Text style={styles.error}>
          {failedHosts.join(", ")} unreachable; showing the other hosts
        </Text>
      ) : null}
      {triage.problem ? <Text style={styles.error}>{triage.problem}</Text> : null}
      <FlatList
        data={rows}
        keyExtractor={(row) => row.item.key}
        renderItem={renderRow}
        ItemSeparatorComponent={separator}
        ListEmptyComponent={
          <Text style={styles.empty}>
            {inbox.items === null
              ? "Loading agents…"
              : view === "attention"
                ? "Nothing needs attention."
                : "No agents match."}
          </Text>
        }
      />
    </View>
  );
}
