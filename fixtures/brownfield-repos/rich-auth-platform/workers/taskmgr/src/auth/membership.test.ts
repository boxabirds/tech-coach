import { expect, test } from "vitest";
import { canAccessProject } from "./membership";

test("membership role access", () => {
  expect(canAccessProject("owner")).toBe(true);
});
