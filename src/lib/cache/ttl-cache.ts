/**
 * A bounded cache with per-entry expiry.
 *
 * Bounded matters more than it looks. Tenant resolution is keyed on an
 * attacker-controlled Host header, so an unbounded map is a memory exhaustion
 * primitive: spray a million distinct hostnames and the process grows until it
 * dies. The size cap makes that spray evict itself instead.
 *
 * Insertion order doubles as recency. Map preserves it, and re-inserting on
 * read moves an entry to the end, so evicting the first key evicts the least
 * recently used one.
 */
export class TtlCache<T> {
  private readonly entries = new Map<string, { value: T; expiresAt: number }>();

  constructor(
    private readonly maxEntries: number,
    private readonly ttlMs: number,
  ) {}

  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;

    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return undefined;
    }

    // Refresh recency without extending the deadline. Expiry is measured from
    // when the value was written, not from when it was last read, so a hot key
    // still gets re-checked against the database on schedule.
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key: string, value: T, ttlMsOverride?: number): void {
    if (this.entries.has(key)) this.entries.delete(key);

    this.entries.set(key, {
      value,
      expiresAt: Date.now() + (ttlMsOverride ?? this.ttlMs),
    });

    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
    }
  }

  delete(key: string): void {
    this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}
