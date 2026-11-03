import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/ui";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Easing,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import type { InboxSettings } from "../shared/inbox-settings";
import { peekAgentOpen, takeAgentOpen } from "./focus-request";
import {
  activityAt,
  buildSections,
  formatWake,
  type InboxItem,
  type InboxRow,
  projectInitials,
  relativeAge,
  SECTION_TITLES,
  type Section,
  stateLabel,
} from "./inbox";
import { delegatedFromServerId, hostColor, title } from "./monitor";
import {
  SNOOZE_PRESETS,
  type SnoozePreset,
  settleRecord,
  snoozeRecord,
  snoozeUntil,
} from "./triage";
import { useInbox } from "./use-inbox";

const CLOCK_INTERVAL_MS = 15_000;
const SETTLED_PREVIEW = 10;

type InboxScreenProps = PluginSurfaceProps & {
  onOpenSettings(): void;
  /** Kept for saved links from older versions; sections need no view. */
  viewParam?: string;
  /** A nonce the sidebar popover sends when it opens this screen to hand off to an agent. */
  openAgentToken?: string;
};

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
  return <InboxSections {...props} inbox={inbox} settings={inbox.settings} />;
}

type Theme = PluginSurfaceProps["theme"];

function useStyles(theme: Theme, compact: boolean) {
  return useMemo(() => {
    const gutter = compact ? 10 : 14;
    const muted = theme.colors.foregroundMuted;
    const row = { flexDirection: "row" as const, alignItems: "center" as const };
    return {
      gutter,
      screen: { flex: 1, backgroundColor: theme.colors.surface0 },
      header: { ...row, gap: 8, paddingHorizontal: gutter, paddingTop: gutter, paddingBottom: 8 },
      searchBox: {
        ...row,
        flex: 1,
        gap: 8,
        paddingHorizontal: 10,
        minHeight: 34,
        borderRadius: 8,
        backgroundColor: theme.colors.surface1,
      },
      searchInput: { flex: 1, color: theme.colors.foreground, fontSize: 14, paddingVertical: 6 },
      iconButton: {
        width: 30,
        height: 30,
        borderRadius: 8,
        alignItems: "center" as const,
        justifyContent: "center" as const,
      },
      content: { flexGrow: 1, paddingHorizontal: gutter / 2, paddingBottom: gutter },
      spacer: { flexGrow: 1, minHeight: 20 },
      card: {
        marginHorizontal: gutter / 2,
        marginBottom: 6,
        paddingHorizontal: 12,
        paddingVertical: 10,
        borderRadius: 10,
        gap: 4,
        backgroundColor: `${theme.colors.accent}1F`,
      },
      cardWorking: { backgroundColor: `${theme.colors.accent}14` },
      cardTop: { ...row, gap: 8 },
      cardPlace: { flex: 1, color: muted, fontSize: 12 },
      cardTitle: { color: theme.colors.foreground, fontSize: 15, fontWeight: "600" as const },
      cardBottom: { ...row, gap: 8, minHeight: 22 },
      cardMeta: { flex: 1, color: muted, fontSize: 12 },
      time: { color: muted, fontSize: 12, fontVariant: ["tabular-nums" as const] },
      working: { ...row, gap: 4 },
      workingText: {
        color: theme.colors.accent,
        fontSize: 12,
        fontWeight: "600" as const,
        fontVariant: ["tabular-nums" as const],
      },
      sectionHeader: {
        ...row,
        gap: 6,
        paddingHorizontal: gutter / 2 + 8,
        paddingTop: 14,
        paddingBottom: 6,
      },
      sectionTitle: { flex: 1, color: muted, fontSize: 13, fontWeight: "600" as const },
      sectionCount: { color: muted, fontSize: 12, fontVariant: ["tabular-nums" as const] },
      line: { ...row, gap: 10, paddingVertical: 7, paddingRight: 8, borderRadius: 8 },
      lineTitle: { flex: 1, color: theme.colors.foreground, fontSize: 14 },
      lineHovered: { backgroundColor: theme.colors.surface1 },
      snoozeTime: { ...row, gap: 4 },
      snoozeText: {
        color: theme.colors.accent,
        fontSize: 12,
        fontVariant: ["tabular-nums" as const],
      },
      avatar: {
        width: 22,
        height: 22,
        borderRadius: 6,
        alignItems: "center" as const,
        justifyContent: "center" as const,
      },
      avatarText: { fontSize: 9, fontWeight: "700" as const },
      actions: { ...row, gap: 2 },
      action: {
        width: 26,
        height: 26,
        borderRadius: 6,
        alignItems: "center" as const,
        justifyContent: "center" as const,
      },
      pressed: { opacity: 0.6 },
      menu: { ...row, flexWrap: "wrap" as const, gap: 6, paddingTop: 4 },
      menuButton: {
        minHeight: 26,
        paddingHorizontal: 8,
        borderRadius: 6,
        borderWidth: 1,
        borderColor: theme.colors.border,
        justifyContent: "center" as const,
      },
      menuText: { color: theme.colors.foreground, fontSize: 12 },
      more: { ...row, gap: 6, paddingVertical: 8, paddingHorizontal: 8 },
      moreText: { color: muted, fontSize: 13 },
      empty: { color: muted, fontSize: 13, paddingHorizontal: gutter, paddingVertical: 8 },
      error: { color: theme.colors.statusDanger, fontSize: 12, paddingHorizontal: gutter },
    };
  }, [compact, theme]);
}

type Styles = ReturnType<typeof useStyles>;

function Avatar({ item, styles, dim }: { item: InboxItem; styles: Styles; dim: boolean }) {
  const color = hostColor(item.host);
  return (
    <View
      accessibilityLabel={item.host ? `Host ${item.host.label}` : undefined}
      style={[styles.avatar, { backgroundColor: `${color}${dim ? "1A" : "33"}` }]}
    >
      <Text style={[styles.avatarText, { color, opacity: dim ? 0.75 : 1 }]}>
        {projectInitials(item.entry.project.projectName)}
      </Text>
    </View>
  );
}

/** A spinning loader; native driver only where it exists. */
function Spinner({ color }: { color: string }) {
  const turn = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(turn, {
        toValue: 1,
        duration: 1200,
        easing: Easing.linear,
        useNativeDriver: Platform.OS !== "web",
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [turn]);
  const rotate = turn.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });
  return (
    <Animated.View style={{ transform: [{ rotate }] }}>
      <Icon name="LoaderCircle" size={13} color={color} />
    </Animated.View>
  );
}

/** "Working 12s", ticking every second inside this row only. */
function WorkingSince({ since, styles, color }: { since: number; styles: Styles; color: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const elapsed = Number.isNaN(since) ? "" : ` ${relativeAge(since, now, false)}`;
  return (
    <View style={styles.working}>
      <Spinner color={color} />
      <Text style={styles.workingText}>Working{elapsed}</Text>
    </View>
  );
}

function workingSince(item: InboxItem): number {
  const turn = (item.entry.agent as { activeTurn?: { startedAt: string | null } | null })
    .activeTurn;
  return Date.parse(turn?.startedAt ?? item.entry.agent.updatedAt);
}

function InboxSections({
  theme,
  layout,
  navigation,
  onOpenSettings,
  inbox,
  settings,
}: InboxScreenProps & { inbox: ReturnType<typeof useInbox>; settings: InboxSettings }) {
  const { monitor, triage, now } = inbox;
  const styles = useStyles(theme, layout.compact);
  const [needle, setNeedle] = useState("");
  const [hovered, setHovered] = useState<string | null>(null);
  const [snoozeMenu, setSnoozeMenu] = useState<string | null>(null);
  const [open, setOpen] = useState<Record<Section, boolean>>({
    attention: true,
    working: true,
    snoozed: false,
    settled: false,
  });
  const [showAllSettled, setShowAllSettled] = useState(false);
  const records = triage.records ?? {};
  const sections = useMemo(
    () => buildSections(inbox.items ?? [], records, needle),
    [inbox.items, records, needle],
  );
  const multiHost = monitor.hosts.length > 1;
  // Touch screens have no hover: keep row actions visible there.
  const alwaysShowActions = layout.compact || Platform.OS !== "web";

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
  const openAgent = useCallback(
    (item: InboxItem) =>
      navigation?.openAgent({
        agentId: item.entry.agent.id,
        ...(item.host ? { serverId: item.host.serverId } : null),
      }),
    [navigation],
  );

  const iconAction = (label: string, icon: string, onPress: () => void) => (
    <Pressable
      key={label}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={4}
      onPress={onPress}
      style={({ pressed }) => [styles.action, pressed && styles.pressed]}
    >
      <Icon name={icon} size={15} color={theme.colors.foregroundMuted} />
    </Pressable>
  );

  const placeOf = (item: InboxItem) => {
    const { project } = item.entry;
    const workspace = project.workspaceName?.trim();
    const scope =
      workspace && workspace !== project.projectName
        ? `${project.projectName}/${workspace}`
        : project.projectName;
    return multiHost && item.host ? `${item.host.label} · ${scope}` : scope;
  };

  const renderCard = ({ item, depth }: InboxRow, working: boolean) => {
    const { agent } = item.entry;
    const name = title(item.entry);
    const state = stateLabel(item);
    const stateColor =
      agent.status === "error" || agent.attentionReason === "error"
        ? theme.colors.statusDanger
        : agent.pendingPermissions.length > 0
          ? theme.colors.statusWarning
          : theme.colors.foregroundMuted;
    const branch = item.entry.project.checkout.isGit
      ? item.entry.project.checkout.currentBranch
      : null;
    const delegatedFrom = item.host ? delegatedFromServerId(agent, item.host.serverId) : null;
    const meta = [
      settings.showPlacement ? branch : null,
      item.subagents > 0 && !settings.showSubagents ? `${item.subagents} sub` : null,
      depth === 0 && item.parentKey ? "subagent" : null,
      delegatedFrom
        ? `from ${monitor.hosts.find((host) => host.serverId === delegatedFrom)?.label ?? delegatedFrom}`
        : null,
    ]
      .filter(Boolean)
      .join(" · ");
    const showActions = !working && (alwaysShowActions || hovered === item.key);
    return (
      <View key={item.key} style={{ marginLeft: depth * 14 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Open agent ${name}`}
          onPress={() => openAgent(item)}
          onHoverIn={() => setHovered(item.key)}
          onHoverOut={() => setHovered((current) => (current === item.key ? null : current))}
          style={({ pressed }) => [
            styles.card,
            working && styles.cardWorking,
            pressed && styles.pressed,
          ]}
        >
          <View style={styles.cardTop}>
            <Avatar item={item} styles={styles} dim={false} />
            <Text style={styles.cardPlace} numberOfLines={1}>
              {placeOf(item)}
            </Text>
            {working ? (
              <WorkingSince
                since={workingSince(item)}
                styles={styles}
                color={theme.colors.accent}
              />
            ) : (
              <Text style={styles.time}>{relativeAge(activityAt(item), now, true)}</Text>
            )}
          </View>
          <Text style={styles.cardTitle} numberOfLines={2}>
            {name}
          </Text>
          <View style={styles.cardBottom}>
            <Text style={styles.cardMeta} numberOfLines={1}>
              {!working && state !== "finished" ? (
                <Text style={{ color: stateColor }}>
                  {state}
                  {meta ? " · " : ""}
                </Text>
              ) : null}
              {meta}
            </Text>
            {showActions ? (
              <View style={styles.actions}>
                {iconAction(`Settle ${name}`, "Check", () => settle(item))}
                {iconAction(`Snooze ${name}`, "AlarmClock", () =>
                  setSnoozeMenu((current) => (current === item.key ? null : item.key)),
                )}
              </View>
            ) : null}
          </View>
          {snoozeMenu === item.key ? (
            <View style={styles.menu}>
              {SNOOZE_PRESETS.map((preset) => (
                <Pressable
                  key={preset.id}
                  accessibilityRole="button"
                  accessibilityLabel={`Snooze ${name} for ${preset.label}`}
                  onPress={() => snooze(item, preset.id)}
                  style={({ pressed }) => [styles.menuButton, pressed && styles.pressed]}
                >
                  <Text style={styles.menuText}>
                    {preset.label} · {formatWake(snoozeUntil(preset.id, now), now)}
                  </Text>
                </Pressable>
              ))}
              {iconAction("Cancel snooze", "X", () => setSnoozeMenu(null))}
            </View>
          ) : null}
        </Pressable>
      </View>
    );
  };

  const renderLine = ({ item, depth }: InboxRow, section: "snoozed" | "settled") => {
    const name = title(item.entry);
    const until = Date.parse(records[item.key]?.until ?? "");
    const isHovered = hovered === item.key;
    const showAction = item.triage !== null && (alwaysShowActions || isHovered);
    return (
      <Pressable
        key={item.key}
        accessibilityRole="button"
        accessibilityLabel={`Open agent ${name}`}
        onPress={() => openAgent(item)}
        onHoverIn={() => setHovered(item.key)}
        onHoverOut={() => setHovered((current) => (current === item.key ? null : current))}
        style={({ pressed }) => [
          styles.line,
          { paddingLeft: 8 + depth * 14 },
          isHovered && styles.lineHovered,
          pressed && styles.pressed,
        ]}
      >
        <Avatar item={item} styles={styles} dim />
        <Text style={styles.lineTitle} numberOfLines={1}>
          {name}
        </Text>
        {showAction
          ? section === "snoozed"
            ? iconAction(`Unsnooze ${name}`, "BellRing", () => restore(item))
            : iconAction(`Undo settle ${name}`, "Undo2", () => restore(item))
          : null}
        {section === "snoozed" && !Number.isNaN(until) ? (
          <View style={styles.snoozeTime}>
            <Icon name="AlarmClock" size={13} color={theme.colors.accent} />
            <Text style={styles.snoozeText}>{relativeAge(now, until, false)}</Text>
          </View>
        ) : (
          <Text style={styles.time}>{relativeAge(activityAt(item), now, true)}</Text>
        )}
      </Pressable>
    );
  };

  const header = (section: Exclude<Section, "attention">, count: number) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${open[section] ? "Collapse" : "Expand"} ${SECTION_TITLES[section]}`}
      accessibilityState={{ expanded: open[section] }}
      onPress={() => setOpen((current) => ({ ...current, [section]: !current[section] }))}
      style={styles.sectionHeader}
    >
      <Text style={styles.sectionTitle}>{SECTION_TITLES[section]}</Text>
      <Text style={styles.sectionCount}>{count}</Text>
      <Icon
        name={open[section] ? "ChevronDown" : "ChevronRight"}
        size={14}
        color={theme.colors.foregroundMuted}
      />
    </Pressable>
  );

  const settledRows = showAllSettled
    ? sections.settled
    : sections.settled.slice(0, SETTLED_PREVIEW);
  const hiddenSettled = sections.settled.length - settledRows.length;
  const loading = inbox.items === null;

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <View style={styles.searchBox}>
          <Icon name="Search" size={15} color={theme.colors.foregroundMuted} />
          <TextInput
            style={styles.searchInput}
            value={needle}
            onChangeText={setNeedle}
            placeholder="Search"
            placeholderTextColor={theme.colors.foregroundMuted}
            autoCapitalize="none"
            autoCorrect={false}
            accessibilityLabel="Search agents by title, host, project or path"
          />
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Refresh agents"
          onPress={monitor.refetchAll}
          style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
        >
          <Icon
            name="RefreshCw"
            size={15}
            color={monitor.isFetching ? theme.colors.accent : theme.colors.foregroundMuted}
          />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open inbox settings"
          onPress={onOpenSettings}
          style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
        >
          <Icon name="Settings" size={15} color={theme.colors.foregroundMuted} />
        </Pressable>
      </View>
      {monitor.failedHosts.length > 0 ? (
        <Text style={styles.error}>{monitor.failedHosts.join(", ")} unreachable</Text>
      ) : null}
      {triage.problem ? <Text style={styles.error}>{triage.problem}</Text> : null}
      <ScrollView contentContainerStyle={styles.content}>
        {loading ? <Text style={styles.empty}>Loading agents…</Text> : null}
        {sections.attention.map((row) => renderCard(row, false))}
        <View style={styles.spacer} />
        {sections.working.length > 0 ? (
          <>
            {header("working", sections.working.length)}
            {open.working ? sections.working.map((row) => renderCard(row, true)) : null}
          </>
        ) : null}
        {sections.snoozed.length > 0 ? (
          <>
            {header("snoozed", sections.snoozed.length)}
            {open.snoozed ? sections.snoozed.map((row) => renderLine(row, "snoozed")) : null}
          </>
        ) : null}
        {sections.settled.length > 0 ? (
          <>
            {header("settled", sections.settled.length)}
            {open.settled ? settledRows.map((row) => renderLine(row, "settled")) : null}
            {open.settled && (hiddenSettled > 0 || showAllSettled) ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => setShowAllSettled((current) => !current)}
                style={styles.more}
              >
                <Icon
                  name={showAllSettled ? "ChevronUp" : "ChevronDown"}
                  size={14}
                  color={theme.colors.foregroundMuted}
                />
                <Text style={styles.moreText}>
                  {showAllSettled ? "Show less" : `Show ${hiddenSettled} more`}
                </Text>
              </Pressable>
            ) : null}
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}
