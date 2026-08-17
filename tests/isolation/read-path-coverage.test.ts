import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as catalog from '@/db/repositories/catalog';
import * as domains from '@/db/repositories/domains';
import * as entitlements from '@/db/repositories/entitlements';
import * as lessons from '@/db/repositories/lessons';
import * as progress from '@/db/repositories/progress';
import * as settings from '@/db/repositories/settings';
import { READ_PATHS } from '../helpers/read-paths';

/**
 * Keeps the isolation suite honest as the codebase grows.
 *
 * The standing rule is that a new read path gets added to the registry in the
 * same commit that introduces it. Rules that depend on remembering do not
 * survive contact with a deadline, so this test enforces it: export a
 * repository function without registering it, and CI fails with the name of
 * the function you forgot.
 *
 * The module list below is checked against the directory, which closes the
 * hole one level up. On its own it covered every function in the modules
 * somebody remembered to list, and said nothing at all about a module nobody
 * did: a whole new repository could arrive unregistered and unchecked. The
 * list is still written out, because static imports are what give the compiler
 * something to check, but forgetting to extend it now fails a test.
 */

const REPOSITORY_MODULES: Record<string, Record<string, unknown>> = {
  catalog,
  domains,
  entitlements,
  lessons,
  progress,
  settings,
};

const REPOSITORY_DIR = resolve(
  import.meta.dirname,
  '../../src/db/repositories',
);

function exportedReadPaths(): string[] {
  const names: string[] = [];

  for (const [moduleName, repositoryModule] of Object.entries(
    REPOSITORY_MODULES,
  )) {
    for (const [exportName, value] of Object.entries(repositoryModule)) {
      if (typeof value === 'function') {
        names.push(`${moduleName}.${exportName}`);
      }
    }
  }

  return names.sort();
}

describe('read path coverage', () => {
  it('checks every repository module in the directory', () => {
    // The assertion that makes the others mean something. Everything below
    // reasons about the modules listed above, so a module that is never listed
    // is a module nothing in this suite has ever looked at.
    const onDisk = readdirSync(REPOSITORY_DIR)
      .filter((file) => file.endsWith('.ts'))
      .map((file) => file.replace(/\.ts$/, ''))
      .sort();

    expect(
      onDisk,
      'a repository module exists that this test does not import, so none of ' +
        'its read paths are checked for tenant scoping. Import it above',
    ).toEqual(Object.keys(REPOSITORY_MODULES).sort());
  });

  it('covers every exported repository function', () => {
    const registered = new Set(READ_PATHS.map((path) => path.name));
    const missing = exportedReadPaths().filter((name) => !registered.has(name));

    expect(
      missing,
      'these repository functions are not in tests/helpers/read-paths.ts, so ' +
        'nothing proves they are tenant scoped. Add them to READ_PATHS',
    ).toEqual([]);
  });

  it('has no registry entry pointing at a function that no longer exists', () => {
    const exported = new Set(exportedReadPaths());
    const stale = READ_PATHS.map((path) => path.name).filter(
      (name) => !exported.has(name),
    );

    expect(stale, 'these registry entries no longer match an export').toEqual(
      [],
    );
  });

  it('has no duplicate registry entries', () => {
    const names = READ_PATHS.map((path) => path.name);
    expect(names).toEqual([...new Set(names)]);
  });
});
