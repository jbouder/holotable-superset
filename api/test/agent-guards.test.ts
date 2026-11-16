import { describe, expect, it } from "vitest";
import { coerceArgs, scopeError } from "../src/agent-guards.ts";

describe("coerceArgs", () => {
  it("decodes objects sent as JSON text and leaves other values alone", () => {
    expect(coerceArgs({ viz: '{"type":"bar"}', title: "{not json", n: 3 })).toEqual({
      viz: { type: "bar" },
      title: "{not json",
      n: 3,
    });
  });
});

describe("scopeError", () => {
  it("lets a new chat create one dashboard and write only to it", () => {
    expect(scopeError("create_dashboard", {}, undefined)).toBeNull();
    expect(scopeError("add_tile", { dashboardId: "x" }, undefined)).toContain("create_dashboard");
    expect(scopeError("add_tile", { dashboardId: "mine" }, "mine")).toBeNull();
  });

  it("refuses writes to any other dashboard and a second dashboard", () => {
    expect(scopeError("update_tile", { dashboardId: "us_births" }, "mine")).toContain('"mine"');
    expect(scopeError("create_dashboard", {}, "mine")).toContain("instead of creating");
  });

  it("never blocks reads", () => {
    expect(scopeError("get_dashboard", { id: "us_births" }, "mine")).toBeNull();
    expect(scopeError("list_datasets", {}, undefined)).toBeNull();
  });
});
