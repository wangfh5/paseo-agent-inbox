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
/** Single-column width, so rows never stretch across a wide window. */
const COLUMN_MAX_WIDTH = 560;
/** At this screen width and above, sections sit side by side in three columns. */
const BOARD_MIN_WIDTH = 880;
const BOARD_MAX_WIDTH = 1320;

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
      container: { flex: 1, width: "100%" as const, alignSelf: "center" as const },
      board: { flex: 1, flexDirection: "row" as const, gap: 8, paddingHorizontal: gutter / 2 },
      boardColumn: { flex: 1, minWidth: 0, maxWidth: 440 },
      boardContent: { paddingBottom: gutter },
      columnHeader: {
        ...row,
        gap: 6,
        paddingHorizontal: gutter / 2 + 8,
        paddingTop: 6,
        paddingBottom: 8,
      },
      placeHost: { fontSize: 11, fontWeight: "700" as const, letterSpacing: 0.2 },
      placeProject: { color: theme.colors.foreground, fontSize: 12, fontWeight: "500" as const },
      placeSep: { color: muted, fontSize: 12 },
      placeWorkspace: { color: muted, fontSize: 12 },
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
        backgroundColor: theme.colors.surface1,
      },
      cardHovered: { backgroundColor: theme.colors.surface2 },
      cardTop: { ...row, gap: 8 },
      cardPlace: { flex: 1, fontSize: 12 },
      cardTitle: { color: theme.colors.foreground, fontSize: 15, fontWeight: "600" as const },
      // Tall enough for the action buttons, so revealing them never resizes the card.
      cardBottom: { ...row, gap: 8, minHeight: 26 },
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
      line: { ...row, gap: 10, minHeight: 38, paddingRight: 8, borderRadius: 8 },
      lineTitle: { flex: 1, color: theme.colors.foreground, fontSize: 14 },
      lineProject: { color: muted, fontSize: 12 },
      lineHovered: { backgroundColor: theme.colors.surface1 },
      snoozeTime: { ...row, gap: 4 },
      snoozeText: {
        color: theme.colors.accent,
        fontSize: 12,
        fontVariant: ["tabular-nums" as const],
      },
      actions: { ...row, gap: 2 },
      concealed: { opacity: 0 },
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
  // Explicit toggles only; untouched sections use the layout's default (see isOpen).
  const [open, setOpen] = useState<Partial<Record<Section, boolean>>>({});
  const [width, setWidth] = useState(0);
  const columns = !layout.compact && width >= BOARD_MIN_WIDTH;
  // Stacked: Snoozed and Settled start collapsed. Columns: each has its own column, so open.
  const isOpen = (section: Section) => open[section] ?? (columns || section === "working");
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

  /** Host, project and workspace, each with its own weight so they read as three things. */
  const place = (item: InboxItem) => {
    const { project } = item.entry;
    const workspace = project.workspaceName?.trim();
    return (
      <Text style={styles.cardPlace} numberOfLines={1}>
        {multiHost && item.host ? (
          <Text style={[styles.placeHost, { color: hostColor(item.host) }]}>
            {item.host.label}
            {"   "}
          </Text>
        ) : null}
        <Text style={styles.placeProject}>{project.projectName}</Text>
        {workspace && workspace !== project.projectName ? (
          <>
            <Text style={styles.placeSep}>{"  /  "}</Text>
            <Text style={styles.placeWorkspace}>{workspace}</Text>
          </>
        ) : null}
      </Text>
    );
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
    const isHovered = hovered === item.key;
    const showActions = alwaysShowActions || isHovered;
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
            isHovered && styles.cardHovered,
            pressed && styles.pressed,
          ]}
        >
          <View style={styles.cardTop}>
            {place(item)}
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
            {working ? null : (
              // Always laid out, only revealed on hover, so hovering never shifts the list.
              <View
                pointerEvents={showActions ? "auto" : "none"}
                style={[styles.actions, !showActions && styles.concealed]}
              >
                {iconAction(`Settle ${name}`, "Check", () => settle(item))}
                {iconAction(`Snooze ${name}`, "AlarmClock", () =>
                  setSnoozeMenu((current) => (current === item.key ? null : item.key)),
                )}
              </View>
            )}
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
    const showAction = alwaysShowActions || isHovered;
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
        <Text style={styles.lineTitle} numberOfLines={1}>
          {name}
          <Text style={styles.lineProject}>
            {"   "}
            {item.entry.project.projectName}
          </Text>
        </Text>
        {item.triage !== null ? (
          <View
            pointerEvents={showAction ? "auto" : "none"}
            style={!showAction ? styles.concealed : undefined}
          >
            {section === "snoozed"
              ? iconAction(`Unsnooze ${name}`, "BellRing", () => restore(item))
              : iconAction(`Undo settle ${name}`, "Undo2", () => restore(item))}
          </View>
        ) : null}
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
      accessibilityLabel={`${isOpen(section) ? "Collapse" : "Expand"} ${SECTION_TITLES[section]}`}
      accessibilityState={{ expanded: isOpen(section) }}
      onPress={() => setOpen((current) => ({ ...current, [section]: !isOpen(section) }))}
      style={styles.sectionHeader}
    >
      <Text style={styles.sectionTitle}>{SECTION_TITLES[section]}</Text>
      <Text style={styles.sectionCount}>{count}</Text>
      <Icon
        name={isOpen(section) ? "ChevronDown" : "ChevronRight"}
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

  const workingCards = sections.working.map((row) => renderCard(row, true));
  const snoozedBlock =
    sections.snoozed.length > 0 ? (
      <>
        {header("snoozed", sections.snoozed.length)}
        {isOpen("snoozed") ? sections.snoozed.map((row) => renderLine(row, "snoozed")) : null}
      </>
    ) : null;
  const settledBlock =
    sections.settled.length > 0 ? (
      <>
        {header("settled", sections.settled.length)}
        {isOpen("settled") ? settledRows.map((row) => renderLine(row, "settled")) : null}
        {isOpen("settled") && (hiddenSettled > 0 || showAllSettled) ? (
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
    ) : null;
  const empty = (text: string) => (loading ? null : <Text style={styles.empty}>{text}</Text>);
  const column = (label: string, count: number, body: React.ReactNode) => (
    <View style={styles.boardColumn}>
      <View style={styles.columnHeader}>
        <Text style={styles.sectionTitle}>{label}</Text>
        <Text style={styles.sectionCount}>{count}</Text>
      </View>
      <ScrollView contentContainerStyle={styles.boardContent}>{body}</ScrollView>
    </View>
  );

  return (
    <View style={styles.screen} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
      <View style={[styles.container, { maxWidth: columns ? BOARD_MAX_WIDTH : COLUMN_MAX_WIDTH }]}>
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
        {loading ? <Text style={styles.empty}>Loading agents…</Text> : null}
        {columns ? (
          <View style={styles.board}>
            {column(
              SECTION_TITLES.attention,
              sections.attention.length,
              sections.attention.length > 0
                ? sections.attention.map((row) => renderCard(row, false))
                : empty("Nothing needs attention"),
            )}
            {column(
              SECTION_TITLES.working,
              sections.working.length,
              sections.working.length > 0 ? workingCards : empty("No agents working"),
            )}
            {column(
              "Later",
              sections.snoozed.length + sections.settled.length,
              snoozedBlock || settledBlock ? (
                <>
                  {snoozedBlock}
                  {settledBlock}
                </>
              ) : (
                empty("Nothing snoozed or settled")
              ),
            )}
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.content}>
            {sections.attention.map((row) => renderCard(row, false))}
            <View style={styles.spacer} />
            {sections.working.length > 0 ? (
              <>
                {header("working", sections.working.length)}
                {isOpen("working") ? workingCards : null}
              </>
            ) : null}
            {snoozedBlock}
            {settledBlock}
          </ScrollView>
        )}
      </View>
    </View>
  );
}
