import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

/**
 * House style bans em dashes in code comments, docs, and UI copy. Use commas,
 * parentheses, colons, or separate sentences.
 *
 * Checked in CI because it is the kind of rule that is easy to agree to and
 * easy to forget, and because it is trivially mechanical.
 */

const EM_DASH = '—';
const EN_DASH = '–';

const SKIPPED = ['LICENSE', 'pnpm-lock.yaml', 'scripts/check-no-em-dash.ts'];

function trackedFiles(): string[] {
  return execFileSync('git', ['ls-files'], { encoding: 'utf8' })
    .split('\n')
    .filter(Boolean);
}

function main(): void {
  const offenders: string[] = [];

  for (const file of trackedFiles()) {
    if (SKIPPED.includes(file)) continue;

    let contents: string;
    try {
      contents = readFileSync(file, 'utf8');
    } catch {
      // Binary or unreadable, nothing to check.
      continue;
    }

    contents.split('\n').forEach((line, index) => {
      if (line.includes(EM_DASH) || line.includes(EN_DASH)) {
        offenders.push(`${file}:${index + 1}: ${line.trim()}`);
      }
    });
  }

  if (offenders.length > 0) {
    console.error(
      'Em or en dashes found. Use commas, parentheses, colons, or separate ' +
        'sentences instead:\n',
    );
    console.error(offenders.join('\n'));
    process.exit(1);
  }

  console.log('no em dashes found');
}

main();
