/** Environment variable used to pass the per-launch IAB key without exposing it in argv. */
export const PENGUIN_IAB_KEY_ENV = 'PENGUIN_IAB_KEY'

/**
 * Reads the relay's IAB key from an environment.
 *
 * Both relay launch paths use this function so `penguin-browser serve` and the background relay
 * cannot drift into different authentication behavior again. The value is never normalized: it is
 * an opaque secret and must reach the relay byte-for-byte.
 */
export function iabKeyFromEnv(
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  return env[PENGUIN_IAB_KEY_ENV] || undefined
}
