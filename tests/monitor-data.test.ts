import { beforeEach, describe, expect, test, vi } from "vitest";
import type { PaseoApi } from "../client/monitor";
import { loadAgents, useAllHostsMonitor } from "../client/monitor-data";

const hooks = vi.hoisted(() => ({
  hosts: [] as Array<{ serverId: string; label: string; status: string }>,
  clients: {} as Record<string, unknown>,
  effects: [] as Array<() => undefined | (() => void)>,
  query: undefined as undefined | { queryFn: () => Promise<unknown> },
}));

vi.mock("@getpaseo/plugin/client", () => ({
  useHosts: () => hooks.hosts,
  getPaseoClient: (serverId: string) => hooks.clients[serverId],
}));
vi.mock("@tanstack/react-query", () => ({
  focusManager: { isFocused: () => true },
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  useQuery: (options: { queryFn: () => Promise<unknown> }) => {
    hooks.query = options;
    return options;
  },
}));
vi.mock("react", () => ({
  useMemo: (factory: () => unknown) => factory(),
  useEffect: (effect: () => undefined | (() => void)) => {
    hooks.effects.push(effect);
  },
}));

function pagedList<T>(...pages: T[][]) {
  let next = 0;
  return vi.fn(async (_options: Record<string, unknown>) => {
    const index = next++;
    const last = index === pages.length - 1;
    return {
      entries: pages[index] ?? [],
      pageInfo: { hasMore: !last, nextCursor: last ? null : `cursor-${index}` },
    };
  });
}

beforeEach(() => {
  hooks.hosts = [];
  hooks.clients = {};
  hooks.effects.length = 0;
  hooks.query = undefined;
});

describe("directory loaders", () => {
  test("agent pages include background workspaces and follow the cursor", async () => {
    const list = pagedList([{ id: "a" }], [{ id: "b" }]);
    const paseo = { agents: { list } } as unknown as PaseoApi;

    const result = await loadAgents(paseo);

    expect(result).toEqual({ entries: [{ id: "a" }, { id: "b" }], truncated: false });
    expect(list).toHaveBeenCalledTimes(2);
    expect(list.mock.calls.map(([options]) => options.includeBackground)).toEqual([true, true]);
    expect(list.mock.calls[1]?.[0]).toMatchObject({ page: { cursor: "cursor-0" } });
  });

  test("agent pages use a key an update cannot reorder, newest first", async () => {
    const list = pagedList([{ id: "a" }]);
    const paseo = { agents: { list } } as unknown as PaseoApi;

    await loadAgents(paseo);

    expect(list).toHaveBeenCalledWith(
      expect.objectContaining({ sort: [{ key: "created_at", direction: "desc" }] }),
    );
  });

  test("reports a truncated roster when the page cap is hit", async () => {
    const list = vi.fn(async () => ({
      entries: [{ id: "a" }],
      pageInfo: { hasMore: true, nextCursor: "next" },
    }));
    const paseo = { agents: { list } } as unknown as PaseoApi;

    const result = await loadAgents(paseo);

    expect(result.truncated).toBe(true);
    expect(list).toHaveBeenCalledTimes(10);
  });
});

describe("useAllHostsMonitor", () => {
  function connect(entryId: string, extraAgents: Array<{ id: string; workspaceId?: string }> = []) {
    const release = vi.fn(async () => {});
    const subscription = { subscribe: vi.fn(() => () => {}), release };
    const agents = {
      list: vi.fn(async (options: Record<string, unknown>) =>
        options.subscribe
          ? { subscription }
          : {
              entries: [
                { id: entryId, agent: { id: entryId, workspaceId: "w1" as string | undefined } },
                ...extraAgents.map((agent) => ({ id: agent.id, agent })),
              ],
              pageInfo: { hasMore: false, nextCursor: null },
            },
      ),
    };
    const workspaces = {
      list: vi.fn(async (options: Record<string, unknown>) =>
        options.subscribe
          ? { subscription }
          : {
              entries: [
                {
                  id: "w1",
                  name: "main",
                  projectId: "p1",
                  projectDisplayName: "Proj",
                  pinnedAt: "now",
                  diffStat: { additions: 3, deletions: 1 },
                },
              ],
              pageInfo: { hasMore: false, nextCursor: null },
            },
      ),
    };
    const projects = {
      list: vi.fn(async () => ({
        projects: [
          {
            projectId: "p1",
            projectKey: "k1",
            projectCustomName: " Renamed ",
            projectDisplayName: "Proj",
          },
        ],
      })),
      subscribe: vi.fn(() => () => {}),
    };
    return { agents, workspaces, projects };
  }

  test("merges every online host and observes each one", async () => {
    const hostA = connect("alpha-entry");
    const hostB = connect("beta-entry");
    hooks.clients = { "srv-a": hostA, "srv-b": hostB };
    hooks.hosts = [
      { serverId: "srv-a", label: "alpha", status: "online" },
      { serverId: "srv-off", label: "offline", status: "offline" },
      { serverId: "srv-b", label: "beta", status: "online" },
    ];

    const monitor = useAllHostsMonitor();
    const data = (await hooks.query?.queryFn()) as {
      entries: Array<{ id: string; hostScope?: { label: string } }>;
      truncated: boolean;
      completeHosts: string[];
    };

    expect(monitor.hosts.map((host) => host.label)).toEqual(["alpha", "beta"]);
    expect(data.entries.map((entry) => entry.id).sort()).toEqual(["alpha-entry", "beta-entry"]);
    expect(data.entries.map((entry) => entry.hostScope?.label).sort()).toEqual(["alpha", "beta"]);
    expect(data.truncated).toBe(false);
    // Only active workspace ids are listed; the project registry is not loaded.
    expect(hostA.workspaces.list).toHaveBeenCalledWith(
      expect.objectContaining({ includeBackground: true, page: { limit: 200 } }),
    );
    expect(hostA.projects.list).not.toHaveBeenCalled();
    expect(data.completeHosts.sort()).toEqual(["srv-a", "srv-b"]);

    const cleanups = hooks.effects.map((effect) => effect()).filter(Boolean);
    await new Promise<void>((resolve) => setImmediate(resolve));
    for (const client of [hostA, hostB]) {
      expect(client.agents.list).toHaveBeenCalledWith({ subscribe: {}, includeBackground: true });
      expect(client.workspaces.list).toHaveBeenCalledWith({
        subscribe: {},
        includeBackground: true,
      });
    }
    for (const cleanup of cleanups) if (typeof cleanup === "function") cleanup();
  });

  test("names a host that fails to load and keeps the others", async () => {
    hooks.clients = { "srv-a": connect("alpha-entry") };
    hooks.hosts = [
      { serverId: "srv-a", label: "alpha", status: "online" },
      { serverId: "srv-b", label: "beta", status: "online" },
    ];

    useAllHostsMonitor();
    const data = (await hooks.query?.queryFn()) as {
      entries: Array<{ id: string }>;
      failedHosts: string[];
    };

    expect(data.failedHosts).toEqual(["beta"]);
    // A failed host is never "complete", so its triage records are kept.
    expect((data as unknown as { completeHosts: string[] }).completeHosts).toEqual(["srv-a"]);
    expect(data.entries.map((entry) => entry.id)).toEqual(["alpha-entry"]);
  });

  test("drops agents whose workspace is archived, keeps agents without a workspace id", async () => {
    hooks.clients = {
      "srv-a": connect("alpha-entry", [
        { id: "orphan", workspaceId: "archived-ws" },
        { id: "no-workspace" },
      ]),
    };
    hooks.hosts = [{ serverId: "srv-a", label: "alpha", status: "online" }];

    useAllHostsMonitor();
    const data = (await hooks.query?.queryFn()) as { entries: Array<{ id: string }> };

    expect(data.entries.map((entry) => entry.id)).toEqual(["alpha-entry", "no-workspace"]);
  });

  test("hides nothing when the workspace list cannot be loaded", async () => {
    const host = connect("alpha-entry", [{ id: "orphan", workspaceId: "archived-ws" }]);
    host.workspaces.list = vi.fn(async (options: Record<string, unknown>) => {
      if (options.subscribe) throw new Error("no subscription in this test");
      throw new Error("workspace list failed");
    }) as typeof host.workspaces.list;
    hooks.clients = { "srv-a": host };
    hooks.hosts = [{ serverId: "srv-a", label: "alpha", status: "online" }];

    useAllHostsMonitor();
    const data = (await hooks.query?.queryFn()) as {
      entries: Array<{ id: string }>;
      failedHosts: string[];
    };

    expect(data.failedHosts).toEqual([]);
    expect(data.entries.map((entry) => entry.id)).toEqual(["alpha-entry", "orphan"]);
  });
});
