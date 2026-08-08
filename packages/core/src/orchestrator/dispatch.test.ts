import { describe, expect, it } from 'bun:test';

import { DISPATCH_SIGIL, resolveDispatch } from './dispatch';

const DISPATCH = { 'hidegh/obsidian': 'obs_dispatcher' };

describe('resolveDispatch', () => {
  describe('when the project is listed in dispatch:', () => {
    it('routes a plain message to the configured workflow', () => {
      expect(resolveDispatch('log this note', 'hidegh/obsidian', DISPATCH)).toEqual({
        kind: 'workflow',
        workflowName: 'obs_dispatcher',
        message: 'log this note',
      });
    });

    it('passes the message through verbatim, without trimming', () => {
      // The workflow receives $ARGUMENTS exactly as the user typed it.
      expect(resolveDispatch('  padded  ', 'hidegh/obsidian', DISPATCH)).toEqual({
        kind: 'workflow',
        workflowName: 'obs_dispatcher',
        message: '  padded  ',
      });
    });

    it('leaves slash commands alone', () => {
      expect(resolveDispatch('/status', 'hidegh/obsidian', DISPATCH)).toEqual({
        kind: 'chat',
        message: '/status',
      });
    });

    it('leaves a slash command alone even with leading whitespace', () => {
      expect(resolveDispatch('  /workflow list', 'hidegh/obsidian', DISPATCH)).toEqual({
        kind: 'chat',
        message: '  /workflow list',
      });
    });

    it('falls through to chat on the sigil, stripping it', () => {
      expect(resolveDispatch('?what did I log today', 'hidegh/obsidian', DISPATCH)).toEqual({
        kind: 'chat',
        message: 'what did I log today',
      });
    });

    it('strips whitespace between the sigil and the question', () => {
      expect(resolveDispatch('?   spaced out', 'hidegh/obsidian', DISPATCH)).toEqual({
        kind: 'chat',
        message: 'spaced out',
      });
    });

    it('passes a bare sigil through rather than handing the AI an empty prompt', () => {
      expect(resolveDispatch('?', 'hidegh/obsidian', DISPATCH)).toEqual({
        kind: 'chat',
        message: '?',
      });
    });

    it('dispatches a message that merely CONTAINS the sigil', () => {
      // Only a LEADING sigil escapes — otherwise "did it work?" would escape too.
      expect(resolveDispatch('did it work?', 'hidegh/obsidian', DISPATCH)).toEqual({
        kind: 'workflow',
        workflowName: 'obs_dispatcher',
        message: 'did it work?',
      });
    });

    it('matches the project key case-insensitively', () => {
      expect(resolveDispatch('note', 'Hidegh/Obsidian', DISPATCH)).toEqual({
        kind: 'workflow',
        workflowName: 'obs_dispatcher',
        message: 'note',
      });
    });

    it('trims a padded workflow name from hand-written YAML', () => {
      expect(resolveDispatch('note', 'proj', { proj: '  obs_dispatcher  ' })).toEqual({
        kind: 'workflow',
        workflowName: 'obs_dispatcher',
        message: 'note',
      });
    });
  });

  describe('when dispatch does not apply', () => {
    it('routes to chat for an unlisted project', () => {
      expect(resolveDispatch('hello', 'some/other-repo', DISPATCH)).toEqual({
        kind: 'chat',
        message: 'hello',
      });
    });

    it('leaves a leading sigil INTACT for an unlisted project', () => {
      // The sigil only means "escape dispatch". Where dispatch does not apply
      // there is nothing to escape, and eating the `?` would silently change
      // what every existing install sends to the AI.
      expect(resolveDispatch('?hello', 'some/other-repo', DISPATCH)).toEqual({
        kind: 'chat',
        message: '?hello',
      });
    });

    it('leaves a leading sigil INTACT when dispatch is not configured at all', () => {
      expect(resolveDispatch('?hello', 'hidegh/obsidian', undefined)).toEqual({
        kind: 'chat',
        message: '?hello',
      });
    });

    it('routes to chat when no project is bound', () => {
      expect(resolveDispatch('hello', undefined, DISPATCH)).toEqual({
        kind: 'chat',
        message: 'hello',
      });
    });

    it('routes to chat when dispatch is not configured', () => {
      expect(resolveDispatch('hello', 'hidegh/obsidian', undefined)).toEqual({
        kind: 'chat',
        message: 'hello',
      });
    });

    it('routes to chat when the table is empty', () => {
      expect(resolveDispatch('hello', 'hidegh/obsidian', {})).toEqual({
        kind: 'chat',
        message: 'hello',
      });
    });
  });

  describe('defensive handling of unvalidated YAML', () => {
    it('ignores a non-string workflow name', () => {
      const malformed = { 'hidegh/obsidian': 42 } as unknown as Record<string, string>;
      expect(resolveDispatch('hello', 'hidegh/obsidian', malformed)).toEqual({
        kind: 'chat',
        message: 'hello',
      });
    });

    it('ignores a blank workflow name', () => {
      expect(resolveDispatch('hello', 'hidegh/obsidian', { 'hidegh/obsidian': '   ' })).toEqual({
        kind: 'chat',
        message: 'hello',
      });
    });

    it('ignores a non-object dispatch value', () => {
      const malformed = 'obs_dispatcher' as unknown as Record<string, string>;
      expect(resolveDispatch('hello', 'hidegh/obsidian', malformed)).toEqual({
        kind: 'chat',
        message: 'hello',
      });
    });
  });

  it('exposes the sigil as a constant so callers and docs cannot drift', () => {
    expect(DISPATCH_SIGIL).toBe('?');
  });
});
