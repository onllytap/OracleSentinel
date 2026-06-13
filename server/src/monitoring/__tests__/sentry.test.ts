import { beforeEach, describe, expect, it } from "vitest";
import { getReleaseName } from "../sentry";

describe("sentry release naming", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.APP_RELEASE;
    delete process.env.VERCEL_GIT_COMMIT_SHA;
    delete process.env.GIT_SHA;
  });

  it("prefers explicit APP_RELEASE", () => {
    process.env.APP_RELEASE = "app@1.2.3";

    expect(getReleaseName()).toBe("app@1.2.3");
  });

  it("falls back to deployment git metadata before the local release", () => {
    process.env.VERCEL_GIT_COMMIT_SHA = "vercel-sha";
    expect(getReleaseName()).toBe("vercel-sha");

    delete process.env.VERCEL_GIT_COMMIT_SHA;
    process.env.GIT_SHA = "git-sha";
    expect(getReleaseName()).toBe("git-sha");
  });

  it("keeps a non-null local release for development and tests", () => {
    expect(getReleaseName()).toBe("premium-lead-generation-chatbot@0.1.0-local");
  });
});
