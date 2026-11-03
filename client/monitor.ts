import type { usePaseo } from "@getpaseo/plugin/client";

export type PaseoApi = ReturnType<typeof usePaseo>;
export type AgentEntry = Awaited<ReturnType<PaseoApi["agents"]["list"]>>["entries"][number];
export type AgentSnapshot = AgentEntry["agent"];

export type HostScope = {
  serverId: string;
  label: string;
};

export const HOST_PALETTE = ["#7aa2f7", "#bb9af7", "#7dcfff", "#9ece6a", "#e0af68", "#f7768e"];

/** A stable accent color per host, derived from the server id. */
export function hostColor(scope: HostScope | null): string {
  if (!scope) return "#8b8b8b";
  let hash = 0;
  for (let index = 0; index < scope.serverId.length; index += 1) {
    hash = (hash * 31 + scope.serverId.charCodeAt(index)) | 0;
  }
  return HOST_PALETTE[Math.abs(hash) % HOST_PALETTE.length] ?? "#8b8b8b";
}

/** Entries tagged by the host they were listed from. */
export type ScopedAgentEntry = AgentEntry & { hostScope?: HostScope };

export function withHostScope(entry: AgentEntry, host: HostScope): ScopedAgentEntry {
  return { ...entry, hostScope: host };
}

export function hostOf(entry: AgentEntry): HostScope | null {
  const scope = (entry as ScopedAgentEntry).hostScope;
  return scope && typeof scope.serverId === "string" ? scope : null;
}

/** The inbox identity of an agent: agent ids are only unique per daemon. */
export function agentKey(serverId: string, agentId: string): string {
  return `${serverId}/${agentId}`;
}

export const PARENT_AGENT_ID_LABEL = "paseo.parent-agent-id";
export const PARENT_SERVER_ID_LABEL = "paseo.parent-server-id";

function trimmed(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * The agent's parent as a (host, agent) pair, or null for a root. Read from the agent's own
 * metadata: the first-class `parentAgentId` field (Paseo 0.15+) or the `paseo.parent-agent-id`
 * label (0.13/0.14). An absent server label means the parent lives on `hostId`. Detaching an agent
 * removes these labels, so a detached agent is a root again.
 */
export function parentAddress(
  agent: AgentSnapshot,
  hostId: string,
): { serverId: string; agentId: string } | null {
  const agentId =
    trimmed(
      "parentAgentId" in agent ? (agent as { parentAgentId?: unknown }).parentAgentId : null,
    ) ?? trimmed(agent.labels?.[PARENT_AGENT_ID_LABEL]);
  if (!agentId) return null;
  return { serverId: trimmed(agent.labels?.[PARENT_SERVER_ID_LABEL]) ?? hostId, agentId };
}

/** The other host that delegated this agent, or null when it has no parent or a local one. */
export function delegatedFromServerId(agent: AgentSnapshot, hostId: string): string | null {
  const parent = parentAddress(agent, hostId);
  return parent && parent.serverId !== hostId ? parent.serverId : null;
}

export function age(since: number, now: number): string {
  if (Number.isNaN(since)) return "";
  const seconds = Math.max(0, Math.round((now - since) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

export function placement(entry: AgentEntry): string {
  const { project } = entry;
  const workspace = project.workspaceName?.trim();
  const scope =
    workspace && workspace !== project.projectName
      ? `${project.projectName} / ${workspace}`
      : project.projectName;
  const branch = project.checkout.isGit ? project.checkout.currentBranch : null;
  return branch ? `${scope} · ${branch}` : scope;
}

export function title(entry: AgentEntry): string {
  const explicit = entry.agent.title?.trim();
  return explicit && explicit.length > 0 ? explicit : entry.agent.id.slice(0, 7);
}

export function matches(entry: AgentEntry, needle: string): boolean {
  if (needle.length === 0) return true;
  return [
    hostOf(entry)?.label ?? "",
    entry.agent.title ?? "",
    entry.agent.id,
    entry.agent.provider,
    entry.agent.model ?? "",
    entry.agent.cwd,
    entry.project.projectName,
    entry.project.workspaceName ?? "",
  ]
    .join(" ")
    .toLowerCase()
    .includes(needle);
}
