import { afterEach, describe, expect, it, vi } from "vitest";
import { developmentLoginHint } from "../src/lib/login-hint";

afterEach(() => vi.unstubAllEnvs());

describe("public development login guidance", () => {
  it("shows an explicitly configured pair only in development", () => {
    vi.stubEnv("DEV", true);
    vi.stubEnv("VITE_PUBLIC_LOGIN_USERNAME", "traveler");
    vi.stubEnv("VITE_PUBLIC_LOGIN_PASSWORD", "public-demo-password");
    expect(developmentLoginHint()).toEqual({
      userId: "traveler",
      password: "public-demo-password",
    });
    vi.stubEnv("DEV", false);
    expect(developmentLoginHint()).toBeNull();
  });

  it("does not invent credentials when configuration is absent or incomplete", () => {
    vi.stubEnv("DEV", true);
    vi.stubEnv("VITE_PUBLIC_LOGIN_USERNAME", "traveler");
    vi.stubEnv("VITE_PUBLIC_LOGIN_PASSWORD", undefined);
    expect(developmentLoginHint()).toBeNull();
    vi.stubEnv("VITE_PUBLIC_LOGIN_PASSWORD", "public-demo-password");
    vi.stubEnv("VITE_PUBLIC_LOGIN_USERNAME", " ");
    expect(developmentLoginHint()).toBeNull();
  });
});
