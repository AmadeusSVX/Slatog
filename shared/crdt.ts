// D3: CRDT primitives for distributed room state
// LWWRegister — single-value Last Write Wins register (e.g. scroll position)
// LWWMap — keyed collection with LWW per entry (e.g. chat messages, pen strokes)

export interface LWWEntry<T> {
  value: T;
  timestamp: number;
}

/** Last Write Wins Register — holds a single value, newer timestamp wins */
export class LWWRegister<T> {
  private entry: LWWEntry<T>;

  constructor(initial: T, timestamp = 0) {
    this.entry = { value: initial, timestamp };
  }

  get value(): T {
    return this.entry.value;
  }

  get timestamp(): number {
    return this.entry.timestamp;
  }

  /** Set value if timestamp is strictly newer */
  set(value: T, timestamp: number): boolean {
    if (timestamp > this.entry.timestamp) {
      this.entry = { value, timestamp };
      return true;
    }
    return false;
  }

  toJSON(): LWWEntry<T> {
    return { ...this.entry };
  }

  static fromJSON<T>(json: LWWEntry<T>): LWWRegister<T> {
    const reg = new LWWRegister<T>(json.value, json.timestamp);
    return reg;
  }
}

/** Last Write Wins Map — keyed entries, each with its own timestamp */
export class LWWMap<T> {
  private entries = new Map<string, LWWEntry<T>>();

  get size(): number {
    return this.entries.size;
  }

  get(key: string): T | undefined {
    return this.entries.get(key)?.value;
  }

  getEntry(key: string): LWWEntry<T> | undefined {
    return this.entries.get(key);
  }

  /** Set entry if timestamp is strictly newer (or key doesn't exist) */
  set(key: string, value: T, timestamp: number): boolean {
    const existing = this.entries.get(key);
    if (!existing || timestamp > existing.timestamp) {
      this.entries.set(key, { value, timestamp });
      return true;
    }
    return false;
  }

  delete(key: string): boolean {
    return this.entries.delete(key);
  }

  has(key: string): boolean {
    return this.entries.has(key);
  }

  /** Return all keys */
  keys(): string[] {
    return [...this.entries.keys()];
  }

  /** Return all entries sorted by timestamp ascending (oldest first) */
  entriesByTime(): [string, LWWEntry<T>][] {
    return [...this.entries.entries()].sort((a, b) => a[1].timestamp - b[1].timestamp);
  }

  /** Return all values sorted by timestamp ascending */
  valuesByTime(): T[] {
    return this.entriesByTime().map(([, e]) => e.value);
  }

  /** Remove the oldest entry by timestamp. Returns the removed key or null. */
  removeOldest(): string | null {
    let oldestKey: string | null = null;
    let oldestTs = Infinity;
    for (const [key, entry] of this.entries) {
      if (entry.timestamp < oldestTs) {
        oldestTs = entry.timestamp;
        oldestKey = key;
      }
    }
    if (oldestKey !== null) {
      this.entries.delete(oldestKey);
    }
    return oldestKey;
  }

  toJSON(): Record<string, LWWEntry<T>> {
    const obj: Record<string, LWWEntry<T>> = {};
    for (const [key, entry] of this.entries) {
      obj[key] = { ...entry };
    }
    return obj;
  }

  static fromJSON<T>(json: Record<string, LWWEntry<T>>): LWWMap<T> {
    const map = new LWWMap<T>();
    for (const [key, entry] of Object.entries(json)) {
      map.entries.set(key, { ...entry });
    }
    return map;
  }
}
