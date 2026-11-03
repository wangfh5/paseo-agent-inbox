import { describe, expect, test } from "vitest";
import {
  attentionSummary,
  buildSections,
  deriveInbox,
  formatWake,
  type InboxItem,
  orderRows,
  relativeAge,
  type Section,
} from "../client/inbox";
import { settleRecord, snoozeRecord } from "../client/triage";
import { buildObservation } from "../client/use-inbox";
import { ALPHA, BETA, childOf, entry, finished, permission } from "./fixtures";

const NOW = Date.parse("2026-11-03T10:00:00.000Z");
const HOUR = 60 * 60 * 1000;

// A orchestrates B and C; B and C both finished unread. D is an unrelated top-level agent.
const A = entry({ id: "A", title: "Lead", status: "running" });
const B = entry({ id: "B", title: "Sub B", ...childOf("A"), ...finished("2026-11-03T09:00:00Z") });
const C = entry({ id: "C", title: "Sub C", ...childOf("A"), ...finished("2026-11-03T09:10:00Z") });
const D = entry({ id: "D", title: "Solo", ...finished("2026-11-03T08:00:00Z") });

function keys(items: readonly InboxItem[]): string[] {
  return items.map((item) => item.key);
}

/** Agent ids per section, in display order. */
function layout(
  items: readonly InboxItem[],
  records: Parameters<typeof buildSections>[1] = {},
  needle = "",
): Record<Section, string[]> {
  const sections = buildSections(items, records, needle);
  const ids = (section: Section) => sections[section].map((row) => row.item.entry.agent.id);
  return {
    attention: ids("attention"),
    working: ids("working"),
    snoozed: ids("snoozed"),
    settled: ids("settled"),
  };
}

const byTitle = (left: InboxItem, right: InboxItem) =>
  (left.entry.agent.title ?? "").localeCompare(right.entry.agent.title ?? "");

describe("subagents are hidden by default", () => {
  test("only the top-level agent shows, and subagent attention is not counted", () => {
    const items = deriveInbox([A, B, C, D], {}, { showSubagents: false, now: NOW });
    expect(keys(items)).toEqual(["srv-alpha/A", "srv-alpha/D"]);
    expect(layout(items)).toEqual({ attention: ["D"], working: ["A"], snoozed: [], settled: [] });
    expect(attentionSummary({ items, truncated: false, failed: false })).toEqual({
      count: 1,
      lowerBound: false,
    });
    expect(items.find((item) => item.key === "srv-alpha/A")?.subagents).toBe(2);
  });

  test("a child stays hidden when its parent is not listed (offline, archived or paged out)", () => {
    const orphan = entry({
      id: "O",
      ...childOf("missing-parent"),
      ...finished("2026-11-03T09:00:00Z"),
    });
    expect(deriveInbox([orphan], {}, { showSubagents: false, now: NOW })).toEqual([]);
  });

  test("a child delegated from another host is hidden, and its parent counts it", () => {
    const parent = entry({ id: "P", title: "Parent" }, ALPHA);
    const remoteChild = entry(
      { id: "R", ...childOf("P", ALPHA.serverId), ...finished("2026-11-03T09:00:00Z") },
      BETA,
    );
    const items = deriveInbox([parent, remoteChild], {}, { showSubagents: false, now: NOW });
    expect(keys(items)).toEqual(["srv-alpha/P"]);
    expect(items[0]?.subagents).toBe(1);
  });

  test("a child in another workspace is still a child", () => {
    const elsewhere = entry({ id: "W", workspaceId: "workspace-2", ...childOf("A") }, ALPHA, {
      workspaceName: "other",
    });
    expect(keys(deriveInbox([A, elsewhere], {}, { showSubagents: false, now: NOW }))).toEqual([
      "srv-alpha/A",
    ]);
  });

  test("a detached agent (parent labels removed) is top level again", () => {
    const detached = entry({
      id: "B",
      title: "Sub B",
      labels: {},
      ...finished("2026-11-03T09:00:00Z"),
    });
    expect(keys(deriveInbox([A, detached], {}, { showSubagents: false, now: NOW }))).toEqual([
      "srv-alpha/A",
      "srv-alpha/B",
    ]);
  });

  test("an agent with no parent metadata is never hidden, whatever its title", () => {
    const named = entry({ id: "X", title: "subagent-auto-review-123" });
    expect(keys(deriveInbox([named], {}, { showSubagents: false, now: NOW }))).toEqual([
      "srv-alpha/X",
    ]);
  });

  test("Show subagents lists children under their parent, nested by generation", () => {
    const grandchild = entry({ id: "G", title: "Grandchild", ...childOf("B") });
    const items = deriveInbox([A, B, C, D, grandchild], {}, { showSubagents: true, now: NOW });
    expect(layout(items).attention).toHaveLength(3);
    const rows = orderRows(items, byTitle);
    expect(rows.map((row) => [row.item.entry.agent.id, row.depth])).toEqual([
      ["A", 0],
      ["B", 1],
      ["G", 2],
      ["C", 1],
      ["D", 0],
    ]);
  });

  test("with subagents shown, a child in another section than its parent is a root row there", () => {
    const items = deriveInbox([A, B, D], {}, { showSubagents: true, now: NOW });
    const sections = buildSections(items, {}, "");
    expect(sections.attention.map((row) => [row.item.entry.agent.id, row.depth])).toEqual([
      ["B", 0],
      ["D", 0],
    ]);
  });
});

describe("multiple hosts", () => {
  const onAlpha = entry(
    { id: "same-id", title: "Fix bug", ...finished("2026-11-03T09:00:00Z") },
    ALPHA,
  );
  const onBeta = entry({ id: "same-id", title: "Fix bug", status: "running" }, BETA);

  test("same title and id on two hosts are two rows with distinct identities", () => {
    const items = deriveInbox([onAlpha, onBeta], {}, { showSubagents: false, now: NOW });
    expect(keys(items)).toEqual(["srv-alpha/same-id", "srv-beta/same-id"]);
    expect(items.map((item) => item.host?.serverId)).toEqual(["srv-alpha", "srv-beta"]);
  });

  test("a triage record on one host never applies to the same id on another", () => {
    const records = { "srv-alpha/same-id": settleRecord(onAlpha.agent, NOW) };
    const betaWaiting = entry({ id: "same-id", ...finished("2026-11-03T09:00:00Z") }, BETA);
    const items = deriveInbox([onAlpha, betaWaiting], records, { showSubagents: false, now: NOW });
    expect(items.map((item) => item.needsAttention)).toEqual([false, true]);
  });

  test("a host listed twice during a reconnect yields one row", () => {
    expect(deriveInbox([onAlpha, onAlpha], {}, { showSubagents: false, now: NOW })).toHaveLength(1);
  });

  test("searching a host label narrows to that host", () => {
    const items = deriveInbox([onAlpha, onBeta], {}, { showSubagents: false, now: NOW });
    expect(layout(items, {}, "beta")).toEqual({
      attention: [],
      working: ["same-id"],
      snoozed: [],
      settled: [],
    });
  });

  test("a failed host makes the badge a lower bound instead of a wrong exact count", () => {
    const items = deriveInbox([onAlpha], {}, { showSubagents: false, now: NOW });
    expect(attentionSummary({ items, truncated: false, failed: true })).toEqual({
      count: 1,
      lowerBound: true,
    });
    expect(attentionSummary({ items: null, truncated: false, failed: false })).toBeNull();
  });

  test("records of an offline host survive; only fully listed hosts prune missing agents", () => {
    const observation = buildObservation([onAlpha], ["srv-alpha"]);
    expect(observation.agents.has("srv-alpha/same-id")).toBe(true);
    expect(observation.completeHosts.has("srv-beta")).toBe(false);
  });
});

describe("settle and snooze in the derived inbox", () => {
  test("settle moves an agent from Needs attention to Settled, keeping its native state", () => {
    const records = { "srv-alpha/D": settleRecord(D.agent, NOW) };
    const items = deriveInbox([A, D], records, { showSubagents: false, now: NOW + HOUR });
    const solo = items.find((item) => item.key === "srv-alpha/D");
    expect(solo).toMatchObject({ base: "attention", triage: "settled", needsAttention: false });
    expect(layout(items)).toEqual({ attention: [], working: ["A"], snoozed: [], settled: ["D"] });
  });

  test("a new turn on a settled agent returns it to the queue", () => {
    const records = { "srv-alpha/D": settleRecord(D.agent, NOW) };
    const again = entry({ id: "D", title: "Solo", ...finished("2026-11-03T11:00:00Z") });
    const items = deriveInbox([again], records, { showSubagents: false, now: NOW + HOUR });
    expect(items[0]).toMatchObject({ triage: null, needsAttention: true });
  });

  test("snooze hides until it expires, then the agent is back without any new event", () => {
    const records = { "srv-alpha/D": snoozeRecord(D.agent, NOW, NOW + HOUR) };
    const during = deriveInbox([D], records, { showSubagents: false, now: NOW + HOUR - 1 });
    expect(layout(during, records)).toMatchObject({ attention: [], snoozed: ["D"] });
    const after = deriveInbox([D], records, { showSubagents: false, now: NOW + HOUR });
    expect(layout(after, records)).toMatchObject({ attention: ["D"], snoozed: [] });
  });

  test("a new permission request wakes a snooze early", () => {
    const records = { "srv-alpha/D": snoozeRecord(D.agent, NOW, NOW + 4 * HOUR) };
    const asking = entry({
      id: "D",
      ...finished("2026-11-03T08:00:00Z"),
      pendingPermissions: [permission("perm-1")] as never,
    });
    const items = deriveInbox([asking], records, { showSubagents: false, now: NOW + HOUR });
    expect(items[0]?.needsAttention).toBe(true);
  });

  test("triage on a subagent stays out of every count while subagents are hidden", () => {
    const records = { "srv-alpha/B": settleRecord(B.agent, NOW) };
    const items = deriveInbox([A, B, C, D], records, { showSubagents: false, now: NOW });
    expect(layout(items)).toEqual({ attention: ["D"], working: ["A"], snoozed: [], settled: [] });
  });

  test("search filters rows but never changes what counts as attention", () => {
    const items = deriveInbox([A, D], {}, { showSubagents: false, now: NOW });
    expect(layout(items, {}, "solo")).toEqual({
      attention: ["D"],
      working: [],
      snoozed: [],
      settled: [],
    });
    expect(attentionSummary({ items, truncated: false, failed: false })?.count).toBe(1);
  });

  test("archived agents are excluded even if a host lists them", () => {
    const archived = entry({
      id: "Z",
      archivedAt: "2026-11-02T00:00:00Z",
      ...finished("2026-11-01T00:00:00Z"),
    });
    expect(deriveInbox([archived], {}, { showSubagents: false, now: NOW })).toEqual([]);
  });
});

describe("sections", () => {
  test("every agent sits in exactly one section; idle and settled share Settled", () => {
    const idle = entry({ id: "I", title: "Idle", updatedAt: "2026-11-03T09:59:00Z" });
    const older = entry({ id: "O", title: "Older", ...finished("2026-11-03T07:00:00Z") });
    const settled = entry({ id: "S", title: "Settled", ...finished("2026-11-03T09:30:00Z") });
    const snoozedLate = entry({ id: "Z2", ...finished("2026-11-03T09:00:00Z") });
    const snoozedSoon = entry({ id: "Z1", ...finished("2026-11-03T09:00:00Z") });
    const records = {
      "srv-alpha/S": settleRecord(settled.agent, NOW),
      "srv-alpha/Z1": snoozeRecord(snoozedSoon.agent, NOW, NOW + HOUR),
      "srv-alpha/Z2": snoozeRecord(snoozedLate.agent, NOW, NOW + 4 * HOUR),
    };
    const items = deriveInbox([idle, older, settled, A, D, snoozedLate, snoozedSoon], records, {
      showSubagents: false,
      now: NOW,
    });
    expect(layout(items, records)).toEqual({
      attention: ["D", "O"],
      working: ["A"],
      snoozed: ["Z1", "Z2"],
      settled: ["I", "S"],
    });
  });

  test("a running agent with a stale finished flag is Working, then rises to attention when done", () => {
    const running = entry({ id: "R", status: "running", ...finished("2026-11-03T08:00:00Z") });
    expect(layout(deriveInbox([running], {}, { showSubagents: false, now: NOW })).working).toEqual([
      "R",
    ]);
    const done = entry({ id: "R", ...finished("2026-11-03T09:55:00Z") });
    expect(layout(deriveInbox([done], {}, { showSubagents: false, now: NOW })).attention).toEqual([
      "R",
    ]);
  });
});

describe("row text helpers", () => {
  test("relative age reads now under a minute when asked", () => {
    expect(relativeAge(NOW - 30_000, NOW, true)).toBe("now");
    expect(relativeAge(NOW - 30_000, NOW, false)).toBe("30s");
    expect(relativeAge(NOW - 2 * HOUR, NOW, true)).toBe("2h");
  });
});

describe("formatWake", () => {
  test("same day shows the time; next day says tomorrow", () => {
    const now = new Date(2026, 10, 3, 10, 0).getTime();
    expect(formatWake(new Date(2026, 10, 3, 14, 5).getTime(), now)).toBe("14:05");
    expect(formatWake(new Date(2026, 10, 4, 9, 0).getTime(), now)).toBe("tomorrow 09:00");
    expect(formatWake(new Date(2026, 10, 6, 9, 0).getTime(), now)).toBe("11/6 09:00");
  });
});
