import { describe, expect, it } from "vitest";
import { fromChatResponse, toChatMessages } from "../src/llm-openai.ts";

describe("fromChatResponse", () => {
  it("turns tool calls into tool_use blocks and keeps reasoning", () => {
    const turn = fromChatResponse({
      choices: [
        {
          finish_reason: "tool_calls",
          message: {
            content: null,
            reasoning_content: "Use add.",
            tool_calls: [{ id: "c1", type: "function", function: { name: "add", arguments: '{"a":2,"b":2}' } }],
          },
        },
      ],
    });
    expect(turn.stop_reason).toBe("tool_use");
    expect(turn.content.map((b) => b.type)).toEqual(["thinking", "tool_use"]);
    expect(turn.content[1]).toMatchObject({ id: "c1", name: "add", input: { a: 2, b: 2 } });
  });

  it("maps a length stop to max_tokens and bad JSON to empty input", () => {
    expect(fromChatResponse({ choices: [{ finish_reason: "length", message: { content: "cut" } }] }).stop_reason).toBe("max_tokens");
    const bad = fromChatResponse({
      choices: [{ finish_reason: "tool_calls", message: { content: null, tool_calls: [{ id: "c", type: "function", function: { name: "x", arguments: "{oops" } }] } }],
    });
    expect(bad.content[0]).toMatchObject({ type: "tool_use", input: {} });
  });
});

describe("toChatMessages", () => {
  it("round-trips a tool turn", () => {
    const out = toChatMessages("sys", [
      { role: "user", content: "hi" },
      {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "plan", signature: "" },
          { type: "tool_use", id: "c1", name: "add", input: { a: 1 } },
        ],
      },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "c1", content: "bad", is_error: true }] },
    ]);
    expect(out).toEqual([
      { role: "system", content: "sys" },
      { role: "user", content: "hi" },
      {
        role: "assistant",
        content: null,
        reasoning_content: "plan",
        tool_calls: [{ id: "c1", type: "function", function: { name: "add", arguments: '{"a":1}' } }],
      },
      { role: "tool", tool_call_id: "c1", content: "Error: bad" },
    ]);
  });
});
