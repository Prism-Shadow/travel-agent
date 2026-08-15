/**
 * Agent identity (agent-identity.ts).
 *
 * The two values that decide which conversation's tab strip a page appears in and which turn may
 * write to it. They arrive from the harness through the child process environment, and the tests
 * that matter are the refusals: this module is the last place a bad value can be stopped before it
 * becomes an ownership key.
 */
import { describe, expect, it } from 'vitest'
import {
  MISSING_IDENTITY_MESSAGE,
  SESSION_ID_ENV,
  TASK_ID_ENV,
  isIdentityValue,
  readAgentIdentity,
} from './agent-identity.js'

const good = {
  [SESSION_ID_ENV]: 'session-2026-08-15-10-30-00-abc12345',
  [TASK_ID_ENV]: 'task-1755000000000-abcdef01',
}

describe('readAgentIdentity', () => {
  it('reads both values from the environment', () => {
    expect(readAgentIdentity(good)).toEqual({
      sessionId: good[SESSION_ID_ENV],
      taskId: good[TASK_ID_ENV],
    })
  })

  it.each([
    ['neither', {}],
    ['only a session', { [SESSION_ID_ENV]: good[SESSION_ID_ENV] }],
    ['only a task', { [TASK_ID_ENV]: good[TASK_ID_ENV] }],
  ])('returns null with %s', (_label, env) => {
    // All or nothing: a session without a task, or a task without a session, is not half an
    // identity but an unusable one — a tab needs both to be placed and owned.
    expect(readAgentIdentity(env)).toBeNull()
  })

  it.each([
    ['an empty value', ''],
    ['a path', '/home/user/projects/app'],
    ['a URL', 'https://example.com/x'],
    ['a shell fragment', 'a; rm -rf /'],
    ['whitespace', '  '],
    ['something enormous', 'x'.repeat(200)],
  ])('refuses %s as an id', (_label, value) => {
    expect(readAgentIdentity({ ...good, [TASK_ID_ENV]: value })).toBeNull()
  })
})

describe('isIdentityValue', () => {
  it.each(['session-1', 'task-1755000000000-abcdef01', 'a.b:c-d_e'])('accepts %s', (value) => {
    expect(isIdentityValue(value)).toBe(true)
  })

  it.each([undefined, null, 42, {}, '', '-leading-dash'])('refuses %s', (value) => {
    expect(isIdentityValue(value)).toBe(false)
  })
})

describe('the missing-identity message', () => {
  it('names the environment variables and no command-line flag', () => {
    // There is deliberately no `--task-id`: the agent runs this command, so a flag would let it
    // name any owner it liked — including a task that has ended and whose tabs are the user's now.
    // A message that suggested one would be documenting a hole.
    expect(MISSING_IDENTITY_MESSAGE).toContain(SESSION_ID_ENV)
    expect(MISSING_IDENTITY_MESSAGE).toContain(TASK_ID_ENV)
    expect(MISSING_IDENTITY_MESSAGE).not.toMatch(/--session-id|--task-id/)
  })
})
