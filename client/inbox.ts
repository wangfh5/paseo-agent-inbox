import type { AgentSort } from "../shared/inbox-settings";
import type { TriageRecords } from "../shared/triage-settings";
import {
  type AgentEntry,
  agentKey,
  type HostScope,
  hostOf,
  matches,
  parentAddress,
  title,
} from "./monitor";
import { type BaseState, baseStateOf, effectiveTriage, type TriageState } from "./triage";

export type InboxItem = {
  /** `<serverId>/<agentId>`: the identity used for React keys and triage records. */
  key: string;
  entry: AgentEntry;
  host: HostScope | null;
  /** Paseo's own state, untouched by triage. */
  base: BaseState;
  triage: TriageState;
  /** True when the agent is in the attention queue: native attention not settled or snoozed. */
  needsAttention: boolean;
  /** The parent's inbox key, or null for a top-level agent. */
  parentKey: string | null;
  /** Direct subagents of this agent across all listed hosts, shown or not. */
  subagents: number;
};

export type InboxView = "attention" | "running" | "idle" | "settled" | "snoozed" | "all";

export const VIEWS: readonly { id: InboxView; label: string }[] = [
  { id: "attention", label: "Needs attention" },
  { id: "running", label: "Running" },
  { id: "idle", label: "Idle" },
  { id: "all", label: "All" },
  { id: "settled", label: "Settled" },
  { id: "snoozed", label: "Snoozed" },
];

export type InboxCounts = Record<InboxView, number>;

export function isSubagent(entry: AgentEntry): boolean {
  return parentAddress(entry.agent, hostOf(entry)?.serverId ?? "") !== null;
}

/**
 * Builds the inbox from raw entries in one pass, so the list, the chips, the sidebar badge and
 * the popover all read the same set. Subagents are identified from their own parent metadata,
 * never from whether the parent happens to be listed, so a child of an unlisted, offline or
 * remote parent stays hidden. Agents with no parent metadata are treated as top level.
 */
export function deriveInbox(
  entries: readonly AgentEntry[],
  records: TriageRecords,
  options: { showSubagents: boolean; now: number },
): InboxItem[] {
  const subagentCounts = new Map<string, number>();
  const parents = new Map<AgentEntry, string>();
  for (const entry of entries) {
    const parent = parentAddress(entry.agent, hostOf(entry)?.serverId ?? "");
    if (!parent) continue;
    const parentKey = agentKey(parent.serverId, parent.agentId);
    parents.set(entry, parentKey);
    subagentCounts.set(parentKey, (subagentCounts.get(parentKey) ?? 0) + 1);
  }
  const items: InboxItem[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    if (entry.agent.archivedAt) continue;
    const parentKey = parents.get(entry) ?? null;
    if (parentKey !== null && !options.showSubagents) continue;
    const host = hostOf(entry);
    const key = agentKey(host?.serverId ?? "", entry.agent.id);
    // A reconnect can briefly list a host twice; one row per agent identity.
    if (seen.has(key)) continue;
    seen.add(key);
    const base = baseStateOf(entry.agent);
    const triage = effectiveTriage(records[key], entry.agent, options.now);
    items.push({
      key,
      entry,
      host,
      base,
      triage,
      needsAttention: base === "attention" && triage === null,
      parentKey,
      subagents: subagentCounts.get(key) ?? 0,
    });
  }
  return items;
}

export function inView(item: InboxItem, view: InboxView): boolean {
  switch (view) {
    case "attention":
      return item.needsAttention;
    case "running":
      return item.base === "running";
    case "idle":
      return item.base === "idle";
    case "settled":
      return item.triage === "settled";
    case "snoozed":
      return item.triage === "snoozed";
    case "all":
      return true;
  }
}

export function countViews(items: readonly InboxItem[]): InboxCounts {
  const counts: InboxCounts = { attention: 0, running: 0, idle: 0, settled: 0, snoozed: 0, all: 0 };
  for (const item of items) {
    for (const { id } of VIEWS) if (inView(item, id)) counts[id] += 1;
  }
  return counts;
}

export function onHost(items: readonly InboxItem[], serverId: string | null): InboxItem[] {
  return serverId === null ? [...items] : items.filter((item) => item.host?.serverId === serverId);
}

export function filterItems(
  items: readonly InboxItem[],
  view: InboxView,
  needle: string,
): InboxItem[] {
  const search = needle.trim().toLowerCase();
  return items.filter((item) => inView(item, view) && matches(item.entry, search));
}

/** When the agent began waiting (for attention) or last changed (otherwise). */
export function activityAt(item: InboxItem): number {
  const { agent } = item.entry;
  const attentionAt =
    item.base === "attention" && agent.attentionTimestamp
      ? Date.parse(agent.attentionTimestamp)
      : NaN;
  return Number.isNaN(attentionAt) ? Date.parse(agent.updatedAt) : attentionAt;
}

const TRIAGE_ORDER: Record<string, number> = { attention: 0, running: 1, triaged: 2, idle: 3 };

function triageRank(item: InboxItem): number {
  if (item.needsAttention) return TRIAGE_ORDER.attention;
  if (item.base === "running") return TRIAGE_ORDER.running;
  if (item.triage !== null) return TRIAGE_ORDER.triaged;
  return TRIAGE_ORDER.idle;
}

export function compareItems(left: InboxItem, right: InboxItem, sort: AgentSort): number {
  if (sort === "title") return title(left.entry).localeCompare(title(right.entry));
  if (sort === "triage") {
    const byRank = triageRank(left) - triageRank(right);
    if (byRank !== 0) return byRank;
  }
  return activityAt(right) - activityAt(left);
}

export type InboxRow = { item: InboxItem; depth: number };

/**
 * Sorted rows. With subagents shown, each child follows its parent indented one level per
 * generation; a child whose parent is not in `items` (filtered out, on an offline host, or
 * unlisted) is a root row of its own so it never disappears.
 */
export function orderRows(items: readonly InboxItem[], sort: AgentSort): InboxRow[] {
  const keys = new Set(items.map((item) => item.key));
  const children = new Map<string, InboxItem[]>();
  const roots: InboxItem[] = [];
  for (const item of items) {
    if (item.parentKey !== null && keys.has(item.parentKey) && item.parentKey !== item.key) {
      const siblings = children.get(item.parentKey);
      if (siblings) siblings.push(item);
      else children.set(item.parentKey, [item]);
    } else {
      roots.push(item);
    }
  }
  const byOrder = (left: InboxItem, right: InboxItem) => compareItems(left, right, sort);
  const rows: InboxRow[] = [];
  const placed = new Set<string>();
  const visit = (item: InboxItem, depth: number) => {
    if (placed.has(item.key)) return;
    placed.add(item.key);
    rows.push({ item, depth });
    for (const child of (children.get(item.key) ?? []).sort(byOrder)) visit(child, depth + 1);
  };
  for (const root of roots.sort(byOrder)) visit(root, 0);
  // A parent cycle has no root; list what is left flat rather than dropping it.
  for (const item of [...items].sort(byOrder)) visit(item, 0);
  return rows;
}

export function stateLabel(item: InboxItem): string {
  const { agent } = item.entry;
  const permissionCount = agent.pendingPermissions.length;
  if (permissionCount > 0) {
    return permissionCount === 1 ? "permission" : `${permissionCount} permissions`;
  }
  if (agent.status === "error") return "error";
  if (agent.status === "running") return "running";
  if (agent.status === "initializing") return "starting";
  if (agent.requiresAttention) return agent.attentionReason ?? "attention";
  return agent.status;
}

/** The badge count, or null when it cannot be trusted yet. A failed or truncated host makes it a lower bound. */
export function attentionSummary(state: {
  items: readonly InboxItem[] | null;
  truncated: boolean;
  failed: boolean;
}): { count: number; lowerBound: boolean } | null {
  if (!state.items) return null;
  const count = state.items.filter((item) => item.needsAttention).length;
  if (count === 0 && state.failed && state.items.length === 0) return null;
  return { count, lowerBound: state.truncated || state.failed };
}

function twoDigits(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

/** "14:05", "tomorrow 09:00" or "11/5 09:00" in the client's local time zone. */
export function formatWake(until: number, now: number): string {
  const date = new Date(until);
  const time = `${twoDigits(date.getHours())}:${twoDigits(date.getMinutes())}`;
  const today = new Date(now);
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const sameDay = (left: Date, right: Date) => left.toDateString() === right.toDateString();
  if (sameDay(date, today)) return time;
  if (sameDay(date, tomorrow)) return `tomorrow ${time}`;
  return `${date.getMonth() + 1}/${date.getDate()} ${time}`;
}
