import { describe, expect, it } from 'vitest';
import * as catalog from '@/db/repositories/catalog';
import * as entitlements from '@/db/repositories/entitlements';
import * as lessons from '@/db/repositories/lessons';
import { READ_PATHS } from '../helpers/read-paths';

/**
 * Keeps the isolation suite honest as the codebase grows.
 *
 * The standing rule is that a new read path gets added to the registry in the
 * same commit that introduces it. Rules that depend on remembering do not
 * survive contact with a deadline, so this test enforces it: export a
 * repository function without registering it, and CI fails with the name of
 * the function you forgot.
 */

const REPOSITORY_MODULES: Record<string, Record<string, unknown>> = {
  catalog,
  entitlements,
  lessons,
};

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
