import type { ReactNode } from 'react';

/**
 * A deliberately small markdown subset, rendered to React elements.
 *
 * WHY NOT A MARKDOWN LIBRARY
 *
 * Two reasons, and the second is the real one.
 *
 * The stack is fixed and a parser is not in it, so adding one is a decision
 * rather than a default. More importantly, a parser alone is not enough: every
 * general markdown renderer passes raw HTML through, because that is what
 * markdown says to do, so it has to be paired with a sanitiser. That is two
 * dependencies and a configuration where being wrong means an institute admin
 * can run script on their own institute's domain, against their own students.
 *
 * This produces React elements and never HTML, so there is no string of markup
 * anywhere and nothing to sanitise. Text is text: React escapes it. The only
 * things that become elements are the ones named below.
 *
 * WHAT IT SUPPORTS
 *
 * Headings, paragraphs, bold, italic, inline code, links, and unordered and
 * ordered lists. That is what a course description and a lesson's notes
 * actually need. If an institute one day needs tables or images, add them here
 * deliberately rather than reaching for a library that brings everything.
 *
 * WHAT IT DOES NOT SUPPORT, ON PURPOSE
 *
 * Raw HTML, of any kind. `<script>alert(1)</script>` in a description renders
 * as that text, visibly, which is the correct outcome for a field an institute
 * types prose into.
 */

/** Only these schemes become links. A javascript: URL is rendered as text. */
const SAFE_LINK = /^https?:\/\//i;

export function renderMarkdown(source: string | null): ReactNode {
  if (!source?.trim()) return null;

  const blocks = source.replace(/\r\n/g, '\n').split(/\n{2,}/);

  return blocks.map((block, index) => {
    const trimmed = block.trim();
    if (!trimmed) return null;

    const heading = /^(#{1,4})\s+(.*)$/.exec(trimmed);
    if (heading) {
      const level = heading[1]?.length ?? 1;
      const text = heading[2] ?? '';
      const className =
        level === 1
          ? 'text-2xl font-semibold tracking-tight'
          : level === 2
            ? 'text-xl font-semibold tracking-tight'
            : 'text-base font-semibold';
      // The tag is chosen from a fixed set rather than built from the level,
      // so no attacker-influenced string ever becomes an element name.
      const Tag = (['h2', 'h3', 'h4', 'h5'] as const)[level - 1] ?? 'h5';
      return (
        <Tag key={index} className={className}>
          {renderInline(text)}
        </Tag>
      );
    }

    const lines = trimmed.split('\n');

    if (lines.every((line) => /^\s*[-*]\s+/.test(line))) {
      return (
        <ul key={index} className="list-disc pl-6">
          {lines.map((line, item) => (
            <li key={item}>{renderInline(line.replace(/^\s*[-*]\s+/, ''))}</li>
          ))}
        </ul>
      );
    }

    if (lines.every((line) => /^\s*\d+[.)]\s+/.test(line))) {
      return (
        <ol key={index} className="list-decimal pl-6">
          {lines.map((line, item) => (
            <li key={item}>
              {renderInline(line.replace(/^\s*\d+[.)]\s+/, ''))}
            </li>
          ))}
        </ol>
      );
    }

    return <p key={index}>{renderInline(trimmed)}</p>;
  });
}

/**
 * Inline spans, applied in one pass so that nesting cannot be used to smuggle
 * anything: each match becomes an element, and everything between matches
 * stays a plain string that React escapes.
 */
function renderInline(text: string): ReactNode[] {
  const pattern =
    /(\*\*[^*]+\*\*)|(\*[^*]+\*)|(`[^`]+`)|(\[[^\]]+\]\([^)\s]+\))/g;

  const out: ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) out.push(text.slice(last, match.index));
    const token = match[0];

    if (token.startsWith('**')) {
      out.push(<strong key={key++}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith('`')) {
      out.push(
        <code key={key++} className="rounded bg-black/5 px-1 py-0.5 text-sm">
          {token.slice(1, -1)}
        </code>,
      );
    } else if (token.startsWith('[')) {
      const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(token);
      const label = link?.[1] ?? token;
      const href = link?.[2] ?? '';
      if (SAFE_LINK.test(href)) {
        out.push(
          <a
            key={key++}
            href={href}
            // An institute's description can link anywhere, so the target gets
            // no access to the opener and no referrer credit.
            rel="noopener noreferrer nofollow"
            target="_blank"
            className="underline underline-offset-4"
          >
            {label}
          </a>,
        );
      } else {
        // A javascript: or data: URL is not a link. Showing the raw text is
        // more useful than silently dropping it: whoever typed it can see why
        // it did not work.
        out.push(token);
      }
    } else {
      out.push(<em key={key++}>{token.slice(1, -1)}</em>);
    }

    last = match.index + token.length;
  }

  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** Renders a markdown block with sensible spacing, or nothing at all. */
export function Markdown({ source }: { source: string | null }) {
  const content = renderMarkdown(source);
  if (!content) return null;

  return <div className="flex flex-col gap-3 leading-relaxed">{content}</div>;
}
