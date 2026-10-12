const { test } = require("node:test");
const assert = require("node:assert/strict");
const { request } = require("../viewer-api.js");
test("API preserves successful empty lists", async () => {
  assert.deepEqual(
    await request(async () => new Response("[]"), "/api/runs"),
    [],
  );
});
test("API identifies server, conflict, permission and validation failures", async () => {
  for (const [status, kind] of [
    [503, "server"],
    [409, "conflict"],
    [403, "permission"],
    [400, "validation"],
    [404, "not-found"],
  ]) {
    await assert.rejects(
      request(
        async () => new Response('{"message":"failure"}', { status }),
        "/api/runs",
      ),
      (e) => e.kind === kind && e.status === status,
    );
  }
});
test("network failure never retries simulation POST", async () => {
  let calls = 0;
  await assert.rejects(
    request(
      async () => {
        calls++;
        throw new TypeError("offline");
      },
      "/api/runs",
      { method: "POST" },
    ),
    (e) => e.kind === "network",
  );
  assert.equal(calls, 1);
});
test("malformed payload is not rendered as a success", async () => {
  await assert.rejects(
    request(async () => new Response("<html>wrong app</html>"), "/api/runs"),
    (e) => e.kind === "invalid",
  );
});
test("request timeout is recoverable and caller abort is retained", async () => {
  const fetcher = (_, options) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => resolve(new Response("{}")), 50);
      options.signal.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          reject(options.signal.reason);
        },
        { once: true },
      );
    });
  await assert.rejects(
    request(fetcher, "/api/runs", { timeoutMs: 5 }),
    (e) => e.kind === "timeout",
  );
});
