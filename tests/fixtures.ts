import type { AgentEntry, HostScope } from "../client/monitor";
import { withHostScope } from "../client/monitor";

export const ALPHA: HostScope = { serverId: "srv-alpha", label: "alpha" };
export const BETA: HostScope = { serverId: "srv-beta", label: "beta" };

type AgentOverrides = Partial<AgentEntry["agent"]>;

export function entry(
  agent: AgentOverrides = {},
  host: HostScope | null = ALPHA,
  project: Partial<AgentEntry["project"]> = {},
): AgentEntry {
  const base = {
    agent: {
      id: "agent-1",
      provider: "claude",
      cwd: "/work/project",
      workspaceId: "workspace-1",
      model: "opus",
      createdAt: "2026-11-01T10:00:00.000Z",
      updatedAt: "2026-11-01T11:00:00.000Z",
      lastUserMessageAt: "2026-11-01T10:00:00.000Z",
      status: "idle",
      capabilities: {},
      currentModeId: null,
      availableModes: [],
      pendingPermissions: [],
      persistence: null,
      title: "Agent",
      labels: {},
      requiresAttention: false,
      attentionReason: null,
      attentionTimestamp: null,
      ...agent,
    },
    project: {
      projectKey: "project-1",
      projectName: "Project",
      workspaceName: "main",
      checkout: { cwd: "/work/project", isGit: false, currentBranch: null },
      ...project,
    },
  } as unknown as AgentEntry;
  return host ? withHostScope(base, host) : base;
}

/** An agent whose turn finished unread at `at`. */
export function finished(at: string, overrides: AgentOverrides = {}): AgentOverrides {
  return {
    requiresAttention: true,
    attentionReason: "finished",
    attentionTimestamp: at,
    ...overrides,
  };
}

export function permission(id: string): { id: string } {
  return { id } as { id: string };
}

export function childOf(parentId: string, parentServerId?: string): AgentOverrides {
  return {
    labels: {
      "paseo.parent-agent-id": parentId,
      ...(parentServerId ? { "paseo.parent-server-id": parentServerId } : {}),
    },
  };
}
