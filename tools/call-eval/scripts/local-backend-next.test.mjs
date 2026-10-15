import { expect, test, vi } from "vitest";
import { runNextRuntime } from "./local-backend-core.mjs";

test("--no-next skips the entire frontend stage, including its launcher", async () => {
  /** @type {string[]} */
  const commands = [];
  const frontend = vi.fn(async () => {
    commands.push("write Next runtime environment", "probe Next HTTP", "pnpm exec next dev");
  });
  expect(await runNextRuntime(["--no-next", "--port=3103"], frontend)).toBe(false);
  expect(frontend).not.toHaveBeenCalled();
  expect(commands).toEqual([]);
});

test("the default dispatch awaits the frontend stage", async () => {
  let finished = false;
  const frontend = vi.fn(async () => {
    await Promise.resolve();
    finished = true;
  });
  expect(await runNextRuntime(["--port=3103"], frontend)).toBe(true);
  expect(frontend).toHaveBeenCalledOnce();
  expect(finished).toBe(true);
});
