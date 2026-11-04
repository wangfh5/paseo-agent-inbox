import { describe, expect, test } from "vitest";
import type { AgentSnapshot } from "../client/monitor";
import {
  applyOps,
  baseStateOf,
  customSnoozeDefaults,
  effectiveTriage,
  hasUnsettledTurn,
  newEventSince,
  nextWakeAt,
  obsoleteKeys,
  parseCustomSnooze,
  planTriageWrite,
  recordHolds,
  settleRecord,
  signatureOf,
  snoozeOptions,
  snoozeRecord,
  snoozeUntil,
  UNOBSERVED_RECORD_TTL_MS,
  wantsAttention,
} from "../client/triage";
import { entry, finished, permission } from "./fixtures";

const T0 = Date.parse("2026-11-03T10:00:00.000Z");
const HOUR = 60 * 60 * 1000;

function agent(overrides: Partial<AgentSnapshot> = {}): AgentSnapshot {
  return entry(overrides).agent;
}

describe("baseStateOf follows Paseo's native classification", () => {
  test("finished unread, permission and error need attention", () => {
    expect(baseStateOf(agent(finished("2026-11-03T09:00:00Z")))).toBe("attention");
    expect(baseStateOf(agent({ pendingPermissions: [permission("p1")] as never }))).toBe(
      "attention",
    );
    expect(baseStateOf(agent({ status: "error" }))).toBe("attention");
  });

  test("running wins over a stale finished flag; idle and initializing are not attention", () => {
    expect(baseStateOf(agent({ status: "running", ...finished("2026-11-03T09:00:00Z") }))).toBe(
      "running",
    );
    expect(baseStateOf(agent({ status: "initializing" }))).toBe("running");
    expect(baseStateOf(agent({ status: "idle" }))).toBe("idle");
  });

  test("closed is resumable, not archived: idle, or attention when it finished unread", () => {
    expect(baseStateOf(agent({ status: "closed" }))).toBe("idle");
    expect(baseStateOf(agent({ status: "closed", ...finished("2026-11-03T09:00:00Z") }))).toBe(
      "attention",
    );
  });
});

describe("newEventSince", () => {
  const settledOn = agent(finished("2026-11-03T09:00:00Z"));
  const stored = signatureOf(settledOn);

  test("a repeated sync, title change or updatedAt bump is not a new event", () => {
    const resynced = agent({
      ...finished("2026-11-03T09:00:00Z"),
      title: "Renamed",
      updatedAt: "2026-11-03T12:00:00Z",
      labels: { something: "else" },
    });
    expect(newEventSince(stored, signatureOf(resynced))).toBeNull();
  });

  test("an automated turn (heartbeat) re-stamping attention is not a new event", () => {
    // Heartbeat prompts are system notifications: lastUserMessageAt stays put.
    expect(newEventSince(stored, signatureOf(agent(finished("2026-11-03T11:00:00Z"))))).toBeNull();
  });

  test("a turn the user started is a task even when attention was re-stamped too", () => {
    const next = agent(
      finished("2026-11-03T11:00:00Z", { lastUserMessageAt: "2026-11-03T10:30:00Z" }),
    );
    expect(newEventSince(stored, signatureOf(next))).toBe("task");
  });

  test("a new permission id outranks everything", () => {
    const next = agent({
      ...finished("2026-11-03T11:00:00Z"),
      pendingPermissions: [permission("p-new")] as never,
    });
    expect(newEventSince(stored, signatureOf(next))).toBe("permission");
  });

  test("a permission that was already pending when settled is not new", () => {
    const withPermission = agent({ pendingPermissions: [permission("p1")] as never });
    expect(newEventSince(signatureOf(withPermission), signatureOf(withPermission))).toBeNull();
  });

  test("an error, or an error-reason attention, is an error", () => {
    expect(newEventSince(stored, signatureOf(agent({ status: "error", lastError: "boom" })))).toBe(
      "error",
    );
    const errorAttention = agent({
      requiresAttention: true,
      attentionReason: "error",
      attentionTimestamp: "2026-11-03T11:00:00Z",
    });
    expect(newEventSince(stored, signatureOf(errorAttention))).toBe("error");
  });

  test("a new user message under unchanged native attention is a new task", () => {
    const next = agent(
      finished("2026-11-03T09:00:00Z", { lastUserMessageAt: "2026-11-03T10:30:00Z" }),
    );
    expect(newEventSince(stored, signatureOf(next))).toBe("task");
  });
});

describe("effectiveTriage", () => {
  const waiting = agent(finished("2026-11-03T09:00:00Z"));

  test("settle hides the same attention however often it is re-synced", () => {
    const record = settleRecord(waiting, T0);
    expect(effectiveTriage(record, waiting, T0 + 10 * HOUR)).toBe("settled");
    const resynced = agent({
      ...finished("2026-11-03T09:00:00Z"),
      updatedAt: "2026-11-04T00:00:00Z",
    });
    expect(effectiveTriage(record, resynced, T0)).toBe("settled");
  });

  test("settle ends on a new prompt, but not on a heartbeat turn or reading the chat", () => {
    const record = settleRecord(waiting, T0);
    expect(effectiveTriage(record, agent(finished("2026-11-03T12:00:00Z")), T0)).toBe("settled");
    expect(
      effectiveTriage(record, agent({ lastUserMessageAt: "2026-11-03T11:00:00Z" }), T0),
    ).toBeNull();
    // Opening the chat clears Paseo's unread flag; the settle still holds.
    expect(effectiveTriage(record, agent({ status: "idle" }), T0)).toBe("settled");
    // While running, the agent shows as working; the record is kept for later.
    expect(effectiveTriage(record, agent({ status: "running" }), T0)).toBeNull();
    expect(recordHolds(record, agent({ status: "running" }), T0)).toBe(true);
  });

  test("a finished turn the user has not settled wants attention even after it was read", () => {
    const baseline = Date.parse("2026-11-03T08:00:00Z");
    const readTurn = agent({ lastUserMessageAt: "2026-11-03T09:00:00Z" });
    expect(baseStateOf(readTurn)).toBe("idle");
    expect(hasUnsettledTurn(readTurn, baseline)).toBe(true);
    expect(wantsAttention(readTurn, baseline)).toBe(true);
    // Turns from before the inbox started tracking count as settled.
    const oldTurn = agent({ lastUserMessageAt: "2026-11-03T07:00:00Z" });
    expect(wantsAttention(oldTurn, baseline)).toBe(false);
    // Paseo's own unread flag still counts, whenever the turn started.
    expect(wantsAttention({ ...oldTurn, ...finished("2026-11-03T07:30:00Z") }, baseline)).toBe(
      true,
    );
    // A running turn is working, not waiting.
    expect(
      wantsAttention(
        agent({ status: "running", lastUserMessageAt: "2026-11-03T09:00:00Z" }),
        baseline,
      ),
    ).toBe(false);
  });

  test("snooze hides until its absolute wake time", () => {
    const record = snoozeRecord(waiting, T0, T0 + HOUR);
    expect(effectiveTriage(record, waiting, T0 + HOUR - 1)).toBe("snoozed");
    expect(effectiveTriage(record, waiting, T0 + HOUR)).toBeNull();
  });

  test("snooze wakes early on a new permission, error or prompt, not on a heartbeat turn", () => {
    const record = snoozeRecord(waiting, T0, T0 + 4 * HOUR);
    const now = T0 + HOUR;
    const withPermission = agent({
      ...finished("2026-11-03T09:00:00Z"),
      pendingPermissions: [permission("p2")] as never,
    });
    expect(effectiveTriage(record, withPermission, now)).toBeNull();
    expect(effectiveTriage(record, agent({ status: "error", lastError: "x" }), now)).toBeNull();
    expect(
      effectiveTriage(record, agent({ lastUserMessageAt: "2026-11-03T10:15:00Z" }), now),
    ).toBeNull();
    // A heartbeat finishing while snoozed keeps the snooze, read or unread.
    expect(effectiveTriage(record, agent(finished("2026-11-03T10:30:00Z")), now)).toBe("snoozed");
    expect(recordHolds(record, agent(finished("2026-11-03T10:30:00Z")), now)).toBe(true);
  });

  test("an ordinary status refresh does not wake a snooze", () => {
    const record = snoozeRecord(waiting, T0, T0 + 4 * HOUR);
    const refreshed = { ...waiting, updatedAt: "2026-11-03T10:45:00Z", title: "New title" };
    expect(effectiveTriage(record, refreshed, T0 + HOUR)).toBe("snoozed");
  });

  test("no record means no triage", () => {
    expect(effectiveTriage(undefined, waiting, T0)).toBeNull();
  });
});

describe("snooze times", () => {
  test("1h and 4h are absolute offsets", () => {
    expect(snoozeUntil("1h", T0)).toBe(T0 + HOUR);
    expect(snoozeUntil("3h", T0)).toBe(T0 + 3 * HOUR);
  });

  test("tomorrow is 09:00 on the next local calendar day", () => {
    const wake = new Date(snoozeUntil("tomorrow", T0));
    const expected = new Date(T0);
    expected.setDate(expected.getDate() + 1);
    expect(wake.getDate()).toBe(expected.getDate());
    expect(wake.getHours()).toBe(9);
    expect(wake.getMinutes()).toBe(0);
  });

  test("evening is 18:00 today and disappears from the menu after 18:00", () => {
    const morning = new Date(2026, 10, 4, 10, 0).getTime();
    expect(new Date(snoozeUntil("evening", morning)).getHours()).toBe(18);
    expect(snoozeOptions(morning).map((option) => option.id)).toEqual([
      "1h",
      "3h",
      "evening",
      "tomorrow",
      "nextWeek",
    ]);
    const night = new Date(2026, 10, 4, 19, 0).getTime();
    expect(snoozeOptions(night).map((option) => option.id)).not.toContain("evening");
  });

  test("next week is the coming Monday 09:00, a full week out on a Monday", () => {
    const wednesday = new Date(2026, 10, 4, 10, 0).getTime(); // Wed 4 Nov 2026
    expect(new Date(snoozeUntil("nextWeek", wednesday))).toEqual(new Date(2026, 10, 9, 9, 0));
    const monday = new Date(2026, 10, 9, 8, 0).getTime();
    expect(new Date(snoozeUntil("nextWeek", monday))).toEqual(new Date(2026, 10, 16, 9, 0));
  });

  test("custom date and time parse in local time and must be in the future", () => {
    const now = new Date(2026, 10, 4, 2, 0).getTime();
    expect(parseCustomSnooze({ mode: "datetime", date: "2026-11-04", time: "02:13" }, now)).toEqual(
      { until: new Date(2026, 10, 4, 2, 13).getTime() },
    );
    expect(parseCustomSnooze({ mode: "datetime", date: "2026-11-04", time: "01:59" }, now)).toEqual(
      { error: "Pick a time in the future" },
    );
    expect(parseCustomSnooze({ mode: "datetime", date: "2026-02-30", time: "09:00" }, now)).toEqual(
      { error: "That date does not exist" },
    );
    expect(
      parseCustomSnooze({ mode: "datetime", date: "11/4", time: "09:00" }, now),
    ).toHaveProperty("error");
    expect(
      parseCustomSnooze({ mode: "datetime", date: "2026-11-05", time: "25:00" }, now),
    ).toHaveProperty("error");
  });

  test("custom duration adds to now; zero, negative or empty is rejected", () => {
    expect(parseCustomSnooze({ mode: "duration", amount: "90", unit: "minutes" }, T0)).toEqual({
      until: T0 + 90 * 60 * 1000,
    });
    expect(parseCustomSnooze({ mode: "duration", amount: "1.5", unit: "days" }, T0)).toEqual({
      until: T0 + 36 * HOUR,
    });
    for (const amount of ["0", "-2", "", "abc"]) {
      expect(parseCustomSnooze({ mode: "duration", amount, unit: "hours" }, T0)).toHaveProperty(
        "error",
      );
    }
  });

  test("custom defaults are one hour ahead", () => {
    const now = new Date(2026, 10, 4, 23, 30).getTime();
    expect(customSnoozeDefaults(now)).toEqual({ date: "2026-11-05", time: "00:30" });
  });

  test("nextWakeAt picks the earliest future snooze and ignores settles and expired ones", () => {
    const waiting = agent(finished("2026-11-03T09:00:00Z"));
    const records = {
      a: snoozeRecord(waiting, T0, T0 + 4 * HOUR),
      b: snoozeRecord(waiting, T0, T0 + HOUR),
      c: snoozeRecord(waiting, T0 - 2 * HOUR, T0 - HOUR),
      d: settleRecord(waiting, T0),
    };
    expect(nextWakeAt(records, T0)).toBe(T0 + HOUR);
    expect(nextWakeAt({ d: records.d }, T0)).toBeNull();
  });
});

describe("record lifecycle", () => {
  const waiting = agent(finished("2026-11-03T09:00:00Z"));
  const key = "srv-alpha/agent-1";
  const remoteKey = "srv-beta/agent-9";

  test("obsolete records: superseded, expired, or missing from a fully listed host", () => {
    const records = {
      [key]: settleRecord(waiting, T0),
      "srv-alpha/read": settleRecord(waiting, T0),
      "srv-alpha/gone": settleRecord(waiting, T0),
      [remoteKey]: settleRecord(waiting, T0),
    };
    const observation = {
      agents: new Map([
        // A new prompt started another turn: the settle is superseded.
        [key, agent({ status: "running", lastUserMessageAt: "2026-11-03T11:00:00Z" })],
        // Read natively, nothing new: the settle stays.
        ["srv-alpha/read", agent({ status: "idle" })],
      ]),
      completeHosts: new Set(["srv-alpha"]),
    };
    // srv-beta is offline: its record is kept.
    expect(obsoleteKeys(records, observation, T0).sort()).toEqual([key, "srv-alpha/gone"].sort());
  });

  test("records on an unreachable host expire only after the TTL", () => {
    const records = { [remoteKey]: settleRecord(waiting, T0) };
    const observation = { agents: new Map(), completeHosts: new Set<string>() };
    expect(obsoleteKeys(records, observation, T0 + UNOBSERVED_RECORD_TTL_MS)).toEqual([]);
    expect(obsoleteKeys(records, observation, T0 + UNOBSERVED_RECORD_TTL_MS + 1)).toEqual([
      remoteKey,
    ]);
  });

  test("a superseding event is permanent: once dropped, a resolved permission cannot revive the settle", () => {
    const record = settleRecord(waiting, T0);
    const asked = agent({
      ...finished("2026-11-03T09:00:00Z"),
      pendingPermissions: [permission("p-new")] as never,
    });
    const observed = (snapshot: AgentSnapshot) => ({
      agents: new Map([[key, snapshot]]),
      completeHosts: new Set(["srv-alpha"]),
    });
    const afterAsk = planTriageWrite({ [key]: record }, [], observed(asked), T0);
    expect(afterAsk).toEqual({});
    // The permission was approved; native attention still carries the old timestamp.
    expect(effectiveTriage(afterAsk?.[key], waiting, T0)).toBeNull();
  });

  test("planTriageWrite writes nothing when the document is already correct", () => {
    const records = { [key]: settleRecord(waiting, T0) };
    const observation = {
      agents: new Map([[key, waiting]]),
      completeHosts: new Set(["srv-alpha"]),
    };
    expect(planTriageWrite(records, [], observation, T0)).toBeNull();
    expect(planTriageWrite(records, [], null, T0)).toBeNull();
  });

  test("ops re-applied to a fresher document keep the other client's records", () => {
    const fromOtherClient = { "srv-beta/other": settleRecord(waiting, T0) };
    const op = { type: "set" as const, key, record: settleRecord(waiting, T0) };
    expect(Object.keys(planTriageWrite(fromOtherClient, [op], null, T0) ?? {}).sort()).toEqual(
      [key, "srv-beta/other"].sort(),
    );
  });

  test("settling on a snapshot that is already stale leaves the newer event visible", () => {
    // The user clicked Settle on the 09:00 attention, but had already sent a new prompt at 10:00.
    const record = settleRecord(waiting, T0);
    const latest = agent(
      finished("2026-11-03T10:30:00Z", { lastUserMessageAt: "2026-11-03T10:00:00Z" }),
    );
    expect(effectiveTriage(record, latest, T0)).toBeNull();
    const observation = { agents: new Map([[key, latest]]), completeHosts: new Set(["srv-alpha"]) };
    expect(planTriageWrite({}, [{ type: "set", key, record }], observation, T0)).toBeNull();
  });

  test("undo deletes the record", () => {
    const records = { [key]: settleRecord(waiting, T0) };
    expect(applyOps(records, [{ type: "delete", key }])).toEqual({});
  });
});
