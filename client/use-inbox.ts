import { type SettingsState, useSettings } from "@getpaseo/plugin/client";
import { useEffect, useMemo, useState } from "react";
import { DEFAULT_SETTINGS, type InboxSettings, inboxSettings } from "../shared/inbox-settings";
import type { TriageRecords } from "../shared/triage-settings";
import { attentionSummary, deriveInbox, type InboxItem } from "./inbox";
import { type AgentEntry, agentKey, hostOf } from "./monitor";
import { type MultiHostMonitor, useAllHostsMonitor } from "./monitor-data";
import { type AttentionSource, nextWakeAt, type Observation } from "./triage";
import { type TriageStore, useTriageStore } from "./triage-store";

export function buildObservation(
  entries: readonly AgentEntry[],
  completeHosts: readonly string[],
): Observation {
  const agents = new Map<string, AttentionSource>();
  for (const entry of entries) {
    agents.set(agentKey(hostOf(entry)?.serverId ?? "", entry.agent.id), entry.agent);
  }
  return { agents, completeHosts: new Set(completeHosts) };
}

/**
 * The current time, refreshed every `intervalMs` and exactly when the next snooze wakes, so an
 * expired snooze returns to the queue without waiting for a new agent event.
 */
export function useClock(intervalMs: number, records: TriageRecords | null): number {
  const [now, setNow] = useState(() => Date.now());
  const wakeAt = records ? nextWakeAt(records, now) : null;
  // Re-armed after every tick: `now` changing is what schedules the next one.
  useEffect(() => {
    const untilWake = wakeAt === null ? intervalMs : Math.max(0, wakeAt - now) + 50;
    const timer = setTimeout(() => setNow(Date.now()), Math.min(intervalMs, untilWake));
    return () => clearTimeout(timer);
  }, [intervalMs, now, wakeAt]);
  return now;
}

export type Inbox = {
  monitor: MultiHostMonitor;
  /** The raw preferences document, for surfaces that save a preference. */
  prefs: SettingsState<typeof inboxSettings.schema>;
  settings: InboxSettings | null;
  triage: TriageStore;
  /** Every listed agent the inbox shows (top level unless subagents are on); null while loading. */
  items: InboxItem[] | null;
  summary: { count: number; lowerBound: boolean } | null;
  now: number;
};

/** The one derivation every surface reads, so list, chips, badge and popover always agree. */
export function useInbox(clockIntervalMs: number): Inbox {
  const monitor = useAllHostsMonitor();
  const prefs = useSettings(inboxSettings);
  const loading = monitor.isPending || monitor.isPlaceholderData;
  const observation = useMemo(
    () => (loading ? null : buildObservation(monitor.entries, monitor.completeHosts)),
    [loading, monitor.entries, monitor.completeHosts],
  );
  const triage = useTriageStore(observation);
  const now = useClock(clockIntervalMs, triage.records);
  // Unreadable preferences fall back to defaults instead of blanking the inbox.
  const settings =
    prefs.status === "ready" ? prefs.values : prefs.status === "loading" ? null : DEFAULT_SETTINGS;
  const showSubagents = settings?.showSubagents ?? null;
  const items = useMemo(
    () =>
      loading || showSubagents === null || !triage.records || triage.baselineAt === null
        ? null
        : deriveInbox(monitor.entries, triage.records, {
            showSubagents,
            now,
            baselineAt: triage.baselineAt,
          }),
    [loading, monitor.entries, now, showSubagents, triage.baselineAt, triage.records],
  );
  const summary = useMemo(
    () =>
      attentionSummary({
        items,
        truncated: monitor.truncated,
        failed: monitor.failedHosts.length > 0,
      }),
    [items, monitor.failedHosts.length, monitor.truncated],
  );
  return { monitor, prefs, settings, triage, items, summary, now };
}
