/**
 * A pending request to open an agent's native chat. The sidebar popover cannot navigate (it only
 * receives `openScreen`), so it leaves the request here and the inbox screen consumes it once. The
 * token ties the request to the screen open that carried it, so a request whose screen never
 * mounted cannot fire on a later, unrelated visit.
 */
export type AgentOpenRequest = {
  agentId: string;
  serverId?: string;
  token: string;
};
let pendingOpen: AgentOpenRequest | null = null;

export function requestAgentOpen(request: AgentOpenRequest): void {
  pendingOpen = { ...request };
}

export function peekAgentOpen(): AgentOpenRequest | null {
  return pendingOpen;
}

export function takeAgentOpen(): AgentOpenRequest | null {
  const request = pendingOpen;
  pendingOpen = null;
  return request;
}
