import { useSettings } from "@getpaseo/plugin/client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { type TriageRecords, triageSettings } from "../shared/triage-settings";
import { applyOps, type Observation, planTriageWrite, type TriageOp } from "./triage";

const MAX_FAILURES = 3;

/**
 * One write at a time per client bundle. The sidebar row and the screen both hold the store; the
 * lock keeps them from racing each other's revision. Writes from other clients surface as
 * revision conflicts and are retried against the fresh document.
 */
let writeInFlight = false;
let consecutiveFailures = 0;

export type TriageStore = {
  /** Saved records with this client's pending changes applied; null while loading. */
  records: TriageRecords | null;
  /** Epoch ms before which finished turns count as settled; null while loading. */
  baselineAt: number | null;
  /** Set when the triage document cannot be read or written. */
  problem: string | null;
  apply(op: TriageOp): void;
};

/**
 * The inbox's own triage document. User actions are applied optimistically and saved in order.
 * When `observation` is present, records that can never apply again are dropped in the same
 * write (see `obsoleteKeys`). Nothing here reads or writes agent or workspace data.
 */
export function useTriageStore(observation: Observation | null): TriageStore {
  const state = useSettings(triageSettings);
  const [pending, setPending] = useState<readonly TriageOp[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  // Stands in for the baseline until the first client has written it.
  const [mountedAt] = useState(() => new Date().toISOString());

  useEffect(() => {
    void retry;
    if (state.status !== "ready" || state.saving || writeInFlight) return;
    if (consecutiveFailures >= MAX_FAILURES && pending.length === 0) return;
    const ops = pending;
    const planned = planTriageWrite(state.values.records, ops, observation, Date.now());
    const needsBaseline = state.values.baselineAt === null;
    if (planned === null && !needsBaseline) {
      if (ops.length > 0) setPending((current) => current.slice(ops.length));
      return;
    }
    const values = {
      records: planned ?? state.values.records,
      baselineAt: state.values.baselineAt ?? mountedAt,
    };
    writeInFlight = true;
    void state.save(values, state.revision).then(async (ok) => {
      writeInFlight = false;
      if (ok) {
        consecutiveFailures = 0;
        setProblem(null);
        setPending((current) => current.slice(ops.length));
        return;
      }
      consecutiveFailures += 1;
      if (consecutiveFailures >= MAX_FAILURES) {
        setProblem(state.saveError ?? "Could not save inbox state");
        setPending((current) => current.slice(ops.length));
        return;
      }
      // Usually a revision conflict with another client: re-read, then re-apply the same ops.
      await state.reload();
      setRetry((value) => value + 1);
    });
  }, [mountedAt, observation, pending, retry, state]);

  const saved = state.status === "ready" ? state.values.records : null;
  const records = useMemo(() => {
    if (saved) return applyOps(saved, pending);
    // An unreadable document must not take the inbox down: show agents without triage.
    return state.status === "loading" ? null : {};
  }, [pending, saved, state.status]);
  const apply = useCallback((op: TriageOp) => {
    consecutiveFailures = 0;
    setPending((current) => [...current, op]);
  }, []);
  const readProblem =
    state.status === "invalid" || state.status === "error"
      ? `Inbox state unavailable: ${state.error}`
      : null;
  const baselineIso =
    state.status === "ready"
      ? (state.values.baselineAt ?? mountedAt)
      : state.status === "loading"
        ? null
        : mountedAt;
  const baselineAt = baselineIso === null ? null : Date.parse(baselineIso);
  return { records, baselineAt, problem: readProblem ?? problem, apply };
}
