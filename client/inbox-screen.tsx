import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/ui";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
  type InboxItem,
  type InboxRow,
  relativeAge,
  SECTION_TITLES,
  type Section,
  stateLabel,
} from "./inbox";
import { delegatedFromServerId, title } from "./monitor";
import { CustomSnoozeModal, SnoozeMenu } from "./snooze-menu";
import { settleRecord, snoozeRecord } from "./triage";
import { useInbox } from "./use-inbox";

const CLOCK_INTERVAL_MS = 15_000;
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
    // One text inset for everything inside a column: headers, card content, rows, hints.
    const inset = 12;
    return {
      gutter,
      screen: { flex: 1, backgroundColor: theme.colors.surface0 },
      container: { flex: 1, width: "100%" as const, alignSelf: "center" as const },
      board: { flex: 1, flexDirection: "row" as const, gap: 8, paddingHorizontal: gutter / 2 },
      boardColumn: { flex: 1, minWidth: 0, maxWidth: 440 },
      boardContent: { paddingBottom: gutter },
      paneFill: { flex: 1 },
      paneShort: { flexGrow: 0, maxHeight: 240, marginBottom: 8 },
      columnHeader: {
        ...row,
        gap: 6,
        paddingHorizontal: inset,
        paddingTop: 6,
        paddingBottom: 8,
      },
      columnTitle: {
        flex: 1,
        color: theme.colors.foreground,
        fontSize: 14,
        fontWeight: "600" as const,
      },
      // Same outer edge as the columns and cards below.
      header: {
        ...row,
        gap: 8,
        paddingHorizontal: gutter / 2,
        paddingTop: gutter,
        paddingBottom: 8,
      },
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
        marginBottom: 6,
        paddingHorizontal: inset,
        paddingVertical: 10,
        borderRadius: 10,
        gap: 4,
        backgroundColor: theme.colors.surface1,
      },
      cardHovered: { backgroundColor: theme.colors.surface2 },
      cardBody: { gap: 4 },
      cardMetaPress: { flex: 1, minHeight: 26, justifyContent: "center" as const },
      cardTop: { flexDirection: "row" as const, alignItems: "flex-start" as const, gap: 8 },
      cardTitle: {
        flex: 1,
        color: theme.colors.foreground,
        fontSize: 15,
        fontWeight: "600" as const,
      },
      cardStatus: { ...row, gap: 4, paddingTop: 2 },
      cardPlace: { color: muted, fontSize: 13 },
      // Tall enough for the action buttons, so revealing them never resizes the card.
      cardBottom: { ...row, gap: 8, minHeight: 26 },
      cardMeta: { ...row, flexWrap: "wrap" as const, columnGap: 10, rowGap: 2 },
      metaItem: { ...row, gap: 4, minWidth: 0, flexShrink: 1 },
      metaText: { color: muted, fontSize: 12, opacity: 0.85, flexShrink: 1 },
      time: { color: muted, fontSize: 12, fontVariant: ["tabular-nums" as const] },
      working: { ...row, gap: 4 },
      workingText: {
        color: theme.colors.accent,
        fontSize: 12,
        fontWeight: "600" as const,
        fontVariant: ["tabular-nums" as const],
      },
      // Opaque, because section headers stick to the top of their scroll view.
      // Far from the group above, close to its own rows, so each group reads as one block.
      sectionHeader: {
        ...row,
        gap: 6,
        backgroundColor: theme.colors.surface0,
        paddingHorizontal: inset,
        paddingTop: 18,
        paddingBottom: 4,
      },
      sectionTitle: { flex: 1, color: muted, fontSize: 12, fontWeight: "700" as const },
      sectionCount: { color: muted, fontSize: 12, fontVariant: ["tabular-nums" as const] },
      line: { ...row, gap: 6, minHeight: 34, paddingRight: inset, borderRadius: 8 },
      linePress: { ...row, flex: 1, gap: 8, alignSelf: "stretch" as const },
      lineInset: inset,
      // Snoozed and Settled rows are parked or done: quieter than headers and cards until hovered.
      lineTitle: { flex: 1, color: muted, fontSize: 14 },
      lineTitleHovered: { color: theme.colors.foreground },
      lineGlyph: {
        width: 14,
        alignItems: "center" as const,
        justifyContent: "center" as const,
      },
      lineDot: {
        width: 6,
        height: 6,
        borderRadius: 3,
        backgroundColor: muted,
        opacity: 0.5,
      },
      lineProject: { color: muted, fontSize: 12, opacity: 0.75 },
      lineHost: { ...row, gap: 3 },
      lineHostText: { color: muted, fontSize: 11, opacity: 0.85 },
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
      empty: { color: muted, fontSize: 13, paddingHorizontal: inset, paddingVertical: 8 },
      error: {
        color: theme.colors.statusDanger,
        fontSize: 12,
        paddingHorizontal: gutter / 2 + inset,
      },
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
  const toggle = (section: Section) =>
    setOpen((current) => ({ ...current, [section]: !isOpen(section) }));
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
  const [customFor, setCustomFor] = useState<InboxItem | null>(null);
  const snooze = useCallback(
    (item: InboxItem, until: number) => {
      setSnoozeMenu(null);
      setCustomFor(null);
      triage.apply({
        type: "set",
        key: item.key,
        record: snoozeRecord(item.entry.agent, Date.now(), until),
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

  /** "project / workspace", the workspace dropped when it repeats the project. */
  const placeText = (item: InboxItem) => {
    const { project } = item.entry;
    const workspace = project.workspaceName?.trim();
    return workspace && workspace !== project.projectName
      ? `${project.projectName} / ${workspace}`
      : project.projectName;
  };
  const metaItem = (key: string, icon: string | null, text: string, color?: string) => (
    <View key={key} style={styles.metaItem}>
      {icon ? <Icon name={icon} size={12} color={color ?? theme.colors.foregroundMuted} /> : null}
      <Text style={[styles.metaText, color ? { color, opacity: 1 } : null]} numberOfLines={1}>
        {text}
      </Text>
    </View>
  );

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
    const { checkout, workspaceName } = item.entry.project;
    const branch = checkout.isGit ? checkout.currentBranch : null;
    const delegatedFrom = item.host ? delegatedFromServerId(agent, item.host.serverId) : null;
    const delegatedLabel = delegatedFrom
      ? (monitor.hosts.find((host) => host.serverId === delegatedFrom)?.label ?? delegatedFrom)
      : null;
    // Tertiary facts with native-style icons; each one appears only when it adds information.
    const meta = [
      multiHost && item.host ? metaItem("host", "Server", item.host.label) : null,
      settings.showPlacement && branch && branch !== workspaceName?.trim()
        ? metaItem("branch", "GitBranch", branch)
        : null,
      depth === 0 && item.parentKey ? metaItem("subagent", "CornerDownRight", "subagent") : null,
      delegatedLabel ? metaItem("delegated", "ArrowLeftRight", `from ${delegatedLabel}`) : null,
    ].filter(Boolean);
    const loud = !working && state !== "finished" && state !== "idle" && state !== "closed";
    const isHovered = hovered === item.key;
    const showActions = alwaysShowActions || isHovered;
    const open = () => openAgent(item);
    return (
      // Hover is tracked on the whole card with pointerenter/leave, which do not fire when the
      // pointer moves onto a child. The action buttons are siblings of the pressable areas, not
      // nested in them, and stay clickable even while visually concealed.
      <View
        key={item.key}
        onPointerEnter={() => setHovered(item.key)}
        onPointerLeave={() => setHovered((current) => (current === item.key ? null : current))}
        style={[styles.card, isHovered && styles.cardHovered, { marginLeft: depth * 14 }]}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Open agent ${name}`}
          onPress={open}
          style={({ pressed }) => [styles.cardBody, pressed && styles.pressed]}
        >
          <View style={styles.cardTop}>
            <Text style={styles.cardTitle} numberOfLines={2}>
              {name}
            </Text>
            <View style={styles.cardStatus}>
              {working ? (
                <WorkingSince
                  since={workingSince(item)}
                  styles={styles}
                  color={theme.colors.accent}
                />
              ) : (
                <Text style={[styles.time, loud ? { color: stateColor } : null]}>
                  {loud ? `${state} · ` : ""}
                  {relativeAge(activityAt(item), now, true)}
                </Text>
              )}
            </View>
          </View>
          {settings.showPlacement ? (
            <Text style={styles.cardPlace} numberOfLines={1}>
              {placeText(item)}
            </Text>
          ) : null}
        </Pressable>
        <View style={styles.cardBottom}>
          <Pressable
            accessibilityElementsHidden
            importantForAccessibility="no"
            onPress={open}
            style={({ pressed }) => [styles.cardMetaPress, pressed && styles.pressed]}
          >
            <View style={styles.cardMeta}>{meta}</View>
          </Pressable>
          {working ? null : (
            <View style={[styles.actions, !showActions && styles.concealed]}>
              {iconAction(`Settle ${name}`, "Check", () => settle(item))}
              {iconAction(`Snooze ${name}`, "AlarmClock", () =>
                setSnoozeMenu((current) => (current === item.key ? null : item.key)),
              )}
            </View>
          )}
        </View>
        {snoozeMenu === item.key ? (
          <SnoozeMenu
            theme={theme}
            now={now}
            onPick={(until) => snooze(item, until)}
            onCustom={() => {
              setSnoozeMenu(null);
              setCustomFor(item);
            }}
          />
        ) : null}
      </View>
    );
  };

  const renderLine = ({ item, depth }: InboxRow, section: "snoozed" | "settled") => {
    const name = title(item.entry);
    const until = Date.parse(records[item.key]?.until ?? "");
    const isHovered = hovered === item.key;
    const showAction = alwaysShowActions || isHovered;
    return (
      <View
        key={item.key}
        onPointerEnter={() => setHovered(item.key)}
        onPointerLeave={() => setHovered((current) => (current === item.key ? null : current))}
        style={[
          styles.line,
          { paddingLeft: styles.lineInset + depth * 14 },
          isHovered && styles.lineHovered,
        ]}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Open agent ${name}`}
          onPress={() => openAgent(item)}
          style={({ pressed }) => [styles.linePress, pressed && styles.pressed]}
        >
          {/* A fixed-width leading glyph indents rows past their section header, as in a
              sidebar: a check for agents the user settled, else Paseo's quiet idle dot. */}
          <View style={styles.lineGlyph}>
            {item.triage === "settled" ? (
              <Icon name="Check" size={13} color={theme.colors.foregroundMuted} />
            ) : (
              <View style={styles.lineDot} />
            )}
          </View>
          <Text style={[styles.lineTitle, isHovered && styles.lineTitleHovered]} numberOfLines={1}>
            {name}
            <Text style={styles.lineProject}>
              {"   "}
              {item.entry.project.projectName}
            </Text>
          </Text>
          {multiHost && item.host ? (
            <View style={styles.lineHost}>
              <Icon name="Server" size={11} color={theme.colors.foregroundMuted} />
              <Text style={styles.lineHostText} numberOfLines={1}>
                {item.host.label}
              </Text>
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
        {item.triage !== null ? (
          <View style={!showAction ? styles.concealed : undefined}>
            {section === "snoozed"
              ? iconAction(`Unsnooze ${name}`, "BellRing", () => restore(item))
              : iconAction(`Undo settle ${name}`, "Undo2", () => restore(item))}
          </View>
        ) : null}
      </View>
    );
  };

  /** A collapsible header; sticks to the top of its scroll view, so collapsing is always one tap away. */
  const header = (key: Section, label: string, count: number, column = false) => (
    // On native, a sticky header is cloned with its style replaced, so the outer View only
    // takes that replacement; the row layout lives on the Pressable inside.
    <View key={`header-${key}`}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${isOpen(key) ? "Collapse" : "Expand"} ${label}`}
        accessibilityState={{ expanded: isOpen(key) }}
        onPress={() => toggle(key)}
        style={column ? styles.columnHeader : styles.sectionHeader}
      >
        <Text style={column ? styles.columnTitle : styles.sectionTitle} numberOfLines={1}>
          {label}
        </Text>
        <Text style={styles.sectionCount}>{count}</Text>
        <Icon
          name={isOpen(key) ? "ChevronDown" : "ChevronRight"}
          size={14}
          color={theme.colors.foregroundMuted}
        />
      </Pressable>
    </View>
  );

  /**
   * Flat children for a ScrollView plus the indices of its headers, which React Native needs as
   * direct children to make them sticky. Collapsed sections keep their header only.
   */
  const stack = (
    parts: Array<{ key: Section; rows: ReactNode[] } | ReactNode>,
  ): { children: ReactNode[]; sticky: number[] } => {
    const children: ReactNode[] = [];
    const sticky: number[] = [];
    for (const part of parts) {
      if (part && typeof part === "object" && "rows" in part && "key" in part) {
        const { key, rows } = part as { key: Section; rows: ReactNode[] };
        if (rows.length === 0) continue;
        sticky.push(children.length);
        children.push(header(key, SECTION_TITLES[key], rows.length));
        if (isOpen(key)) children.push(...rows);
      } else if (part) {
        children.push(part);
      }
    }
    return { children, sticky };
  };

  const loading = inbox.items === null;
  const attentionCards = sections.attention.map((row) => renderCard(row, false));
  const workingCards = sections.working.map((row) => renderCard(row, true));
  const snoozedRows = sections.snoozed.map((row) => renderLine(row, "snoozed"));
  const settledRows = sections.settled.map((row) => renderLine(row, "settled"));
  const empty = (text: string) =>
    loading ? null : (
      <Text key="empty" style={styles.empty}>
        {text}
      </Text>
    );

  /** One section as a column pane: its header always visible, its body scrolling on its own. */
  const pane = (
    key: Section,
    rows: ReactNode[],
    emptyText: string | null,
    bodyStyle: object = styles.paneFill,
  ) => (
    <>
      {header(key, SECTION_TITLES[key], rows.length, true)}
      {isOpen(key) ? (
        <ScrollView style={bodyStyle} contentContainerStyle={styles.boardContent}>
          {rows.length > 0 ? rows : emptyText ? empty(emptyText) : null}
        </ScrollView>
      ) : null}
    </>
  );

  const stacked = stack([
    ...attentionCards,
    <View key="spacer" style={styles.spacer} />,
    { key: "working", rows: workingCards },
    { key: "snoozed", rows: snoozedRows },
    { key: "settled", rows: settledRows },
  ]);

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
            <View style={styles.boardColumn}>
              {pane("attention", attentionCards, "Nothing needs attention")}
            </View>
            <View style={styles.boardColumn}>
              {pane("working", workingCards, "No agents working")}
            </View>
            {/* Snoozed and Settled are peers of the other sections, stacked in one column:
                Snoozed sized to its few rows, Settled filling the rest. */}
            <View style={styles.boardColumn}>
              {snoozedRows.length > 0 ? pane("snoozed", snoozedRows, null, styles.paneShort) : null}
              {pane("settled", settledRows, "Nothing settled yet")}
            </View>
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.content} stickyHeaderIndices={stacked.sticky}>
            {stacked.children}
          </ScrollView>
        )}
      </View>
      {customFor ? (
        <CustomSnoozeModal
          key={customFor.key}
          theme={theme}
          open
          title={title(customFor.entry)}
          onClose={() => setCustomFor(null)}
          onSnooze={(until) => snooze(customFor, until)}
        />
      ) : null}
    </View>
  );
}
