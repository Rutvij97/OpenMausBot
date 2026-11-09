import { describe, expect, it } from "vitest";
import type { Message } from "../store.ts";
import { OUTSIDE, steeredWorkOrigin } from "../peer-provenance.ts";
import { createSteeredRequests, type SteeredRequestOwner } from "./steered-request.ts";

const line = (text: string, patch: Partial<Message> = {}): Message =>
  ({ id: "m2", role: "user", kind: "text", text, at: 2, steered: true, ...patch }) as Message;
const PERSON = "p_abcdefghijklmnopqrstuv";

describe("steeredWorkOrigin", () => {
  it("takes the person's newer words and keeps whom the work is for", () => {
    expect(steeredWorkOrigin({ kind: "user", request: "old request" }, line("actual request"))).toEqual({ kind: "user", request: "actual request" });
    expect(steeredWorkOrigin({ kind: "user", request: "old", person: PERSON }, line("new"))).toEqual({ kind: "user", request: "new", person: PERSON });
  });

  it("never gives a turn that was not the person's their authority", () => {
    expect(steeredWorkOrigin(OUTSIDE, line("do it"))).toBeUndefined();
    expect(steeredWorkOrigin(undefined, line("do it"))).toBeUndefined();
  });

  it("leaves the person's request alone for a line that is not their own words", () => {
    const current = { kind: "user" as const, request: "old request" };
    for (const patch of [{ peerAsk: true }, { relayed: true }, { aside: true }, { via: "api" }, { fromApp: { name: "Widget" } }, { role: "bot" }, { kind: "activity" }] as Partial<Message>[]) {
      expect(steeredWorkOrigin(current, line("other words", patch))).toBeUndefined();
    }
    expect(steeredWorkOrigin(current, line("   "))).toBeUndefined();
  });
});

describe("steered requests", () => {
  const setup = (owner: SteeredRequestOwner | undefined, { accepts = true, started = line("old request", { id: "m1" }) } = {}) => {
    const calls: Array<[string, string]> = [];
    const requests = createSteeredRequests({
      owner: () => owner,
      line: (_threadId, id) => (id === started.id ? started : undefined),
      requote: (id, request) => { calls.push([id, request]); return accepts; },
    });
    return { calls, requests };
  };
  const running = (): SteeredRequestOwner => ({ generation: "g1", messageId: "m1", origin: { kind: "user", request: "old request" } });

  it("quotes the person's own steered line in the turn's record and its work tree's root", () => {
    const owner = running(), { calls, requests } = setup(owner);
    expect(requests.generation("t")).toBe("g1");
    expect(requests.requote("t", "g1", line("actual request"), true)).toBe(true);
    expect(owner.origin).toEqual({ kind: "user", request: "actual request" });
    expect(calls).toEqual([["g1", "actual request"]]);
  });

  it("never takes a line the server did not see the person send", () => {
    const owner = running(), { calls, requests } = setup(owner);
    expect(requests.requote("t", "g1", line("from a bot through the API"), false)).toBe(false);
    expect(owner.origin).toEqual({ kind: "user", request: "old request" });
    expect(calls).toEqual([]);
  });

  it("never lets a different person's line speak for whoever started the turn", () => {
    const owner = running();
    const { calls, requests } = setup(owner, { started: line("old request", { id: "m1", sender: { id: "alice", name: "Alice" } } as Partial<Message>) });
    expect(requests.requote("t", "g1", line("bob's words", { sender: { id: "bob", name: "Bob" } } as Partial<Message>), true)).toBe(false);
    expect(requests.requote("t", "g1", line("alice's words", { sender: { id: "alice", name: "Alice" } } as Partial<Message>), true)).toBe(true);
    expect(calls).toEqual([["g1", "alice's words"]]);
  });

  it("ignores a late acknowledgement once another turn holds the chat", () => {
    const owner = running(), { calls, requests } = setup(owner);
    owner.generation = "g2";
    expect(requests.requote("t", "g1", line("late words"), true)).toBe(false);
    expect(requests.requote("t", undefined, line("late words"), true)).toBe(false);
    expect(calls).toEqual([]);
  });

  it("keeps the turn's record when the work tree's root refuses the words", () => {
    const owner = running(), { calls, requests } = setup(owner, { accepts: false });
    expect(requests.requote("t", "g1", line("actual request"), true)).toBe(false);
    expect(owner.origin).toEqual({ kind: "user", request: "old request" });
    expect(calls).toEqual([["g1", "actual request"]]);
  });

  it("does nothing for a stopped, missing or outside turn", () => {
    expect(setup(undefined).requests.requote("t", "g1", line("x"), true)).toBe(false);
    const stopped = { ...running(), stopped: true };
    expect(setup(stopped).requests.requote("t", "g1", line("x"), true)).toBe(false);
    expect(stopped.origin).toEqual({ kind: "user", request: "old request" });
    const outside: SteeredRequestOwner = { generation: "g1", messageId: "m1", origin: OUTSIDE };
    const { calls, requests } = setup(outside);
    expect(requests.requote("t", "g1", line("x"), true)).toBe(false);
    expect(outside.origin).toBe(OUTSIDE);
    expect(calls).toEqual([]);
  });
});
