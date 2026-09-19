/**
 * R4 — Case polling hook tests (shell-owned region patcher).
 * casePollingScript only configures __northstarPollConfig; it must not swap <main>.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { casePollingScript } from "../src/ui/casePolling.ts";

test("casePollingScript configures the case poll URL with format=html", () => {
  const script = casePollingScript({ caseRef: "CASE-001" });
  assert.ok(script.includes("/api/v2/cases/"), "must contain case endpoint");
  assert.ok(script.includes("format=html"), "must request HTML format");
  assert.ok(script.includes("CASE-001"), "must include the caseRef");
  assert.ok(script.includes("__northstarPollConfig"), "must hand config to shell runtime");
});

test("casePollingScript carries sinceCursor echo config", () => {
  const script = casePollingScript({ caseRef: "CASE-001" });
  assert.ok(script.includes("sinceCursor") || script.includes("cursorParam"), "must reference sinceCursor");
});

test("casePollingScript has default interval 4000ms", () => {
  const script = casePollingScript({ caseRef: "CASE-001" });
  assert.ok(script.includes("4000"), "default interval must be 4000ms");
});

test("casePollingScript interval is configurable", () => {
  const script = casePollingScript({ caseRef: "CASE-001", intervalMs: 5000 });
  assert.ok(script.includes("5000"), "custom interval must be applied");
});

test("casePollingScript contains no WebSocket or EventSource tokens", () => {
  const script = casePollingScript({ caseRef: "CASE-001" });
  assert.ok(!script.includes("WebSocket"), "must not use WebSocket");
  assert.ok(!script.includes("EventSource"), "must not use SSE");
});

test("casePollingScript does not replace main via outerHTML", () => {
  const script = casePollingScript({ caseRef: "CASE-001" });
  assert.ok(!script.includes("outerHTML"), "main replacement is forbidden");
});

test("casePollingScript output is deterministic", () => {
  const script1 = casePollingScript({ caseRef: "CASE-001", intervalMs: 4000 });
  const script2 = casePollingScript({ caseRef: "CASE-001", intervalMs: 4000 });
  assert.equal(script1, script2, "same options must produce identical output");
});
