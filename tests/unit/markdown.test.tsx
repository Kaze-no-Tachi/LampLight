import { describe, expect, it } from 'vitest';
import { renderMarkdown } from '@/lib/markdown/render';

/**
 * The renderer produces React elements, never HTML, so there is no markup
 * string to sanitise and no dangerouslySetInnerHTML anywhere. These assert the
 * consequence: anything that is not one of the handful of constructs the
 * subset names stays text, and text is escaped by React.
 *
 * Course descriptions are typed by institute staff, which is semi-trusted
 * rather than trusted. An admin who can run script on their own institute's
 * domain can run it against their own students, and staff accounts get
 * compromised like any others.
 */

/** Walks the tree collecting element types, so structure can be asserted. */
function tags(node: unknown, found: string[] = []): string[] {
  if (Array.isArray(node)) {
    for (const child of node) tags(child, found);
    return found;
  }
  if (node && typeof node === 'object' && 'type' in node) {
    const element = node as { type: unknown; props?: { children?: unknown } };
    if (typeof element.type === 'string') found.push(element.type);
    if (element.props?.children) tags(element.props.children, found);
  }
  return found;
}

/** Collects every plain string in the tree. */
function text(node: unknown, found: string[] = []): string[] {
  if (typeof node === 'string') {
    found.push(node);
    return found;
  }
  if (Array.isArray(node)) {
    for (const child of node) text(child, found);
    return found;
  }
  if (node && typeof node === 'object' && 'props' in node) {
    const element = node as { props?: { children?: unknown } };
    if (element.props?.children) text(element.props.children, found);
  }
  return found;
}

describe('what it renders', () => {
  it('handles the constructs a course description needs', () => {
    const tree = renderMarkdown(
      [
        '## About this course',
        '',
        'A survey of the **Old Testament**, with *close reading*.',
        '',
        '- Genesis to Deuteronomy',
        '- The historical books',
        '',
        'See the [reading list](https://example.edu/list).',
      ].join('\n'),
    );

    const found = tags(tree);
    expect(found).toContain('h3');
    expect(found).toContain('strong');
    expect(found).toContain('em');
    expect(found).toContain('ul');
    expect(found).toContain('li');
    expect(found).toContain('a');
  });

  it('numbers an ordered list', () => {
    expect(tags(renderMarkdown('1. First\n2. Second'))).toContain('ol');
  });

  it('renders nothing for nothing', () => {
    expect(renderMarkdown(null)).toBeNull();
    expect(renderMarkdown('   ')).toBeNull();
  });
});

describe('what it refuses to render', () => {
  it('leaves a script tag as visible text', () => {
    const tree = renderMarkdown('Hello <script>alert(1)</script> there');

    // No element of any kind beyond the paragraph, and the tag survives as
    // text, which React escapes on the way out.
    expect(tags(tree)).toEqual(['p']);
    expect(text(tree).join('')).toContain('<script>alert(1)</script>');
  });

  it('leaves an img with an onerror handler as text', () => {
    const tree = renderMarkdown('<img src=x onerror="alert(1)">');
    expect(tags(tree)).toEqual(['p']);
  });

  it('does not make a javascript: URL into a link', () => {
    const tree = renderMarkdown('[click me](javascript:alert(1))');

    expect(tags(tree)).toEqual(['p']);
    // Shown as written, so whoever typed it can see why it did not work.
    expect(text(tree).join('')).toContain('javascript:');
  });

  it('does not make a data: URL into a link', () => {
    const tree = renderMarkdown(
      '[x](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)',
    );
    expect(tags(tree)).toEqual(['p']);
  });

  it('only links http and https', () => {
    expect(tags(renderMarkdown('[a](https://example.edu)'))).toContain('a');
    expect(tags(renderMarkdown('[a](http://example.edu)'))).toContain('a');
    expect(tags(renderMarkdown('[a](ftp://example.edu)'))).not.toContain('a');
    expect(tags(renderMarkdown('[a](/relative)'))).not.toContain('a');
  });

  it('never builds a tag name from the input', () => {
    // A heading deeper than the subset allows must not produce an element
    // named from the input. It falls back to a fixed tag.
    const found = tags(renderMarkdown('####### way too deep'));
    for (const tag of found) {
      expect(['p', 'h2', 'h3', 'h4', 'h5']).toContain(tag);
    }
  });
});
