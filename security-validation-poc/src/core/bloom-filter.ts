// Compact Bloom filter used to ship the ~129k-term whitelist to the browser
// in ~160KB instead of ~2.5MB of raw strings. False positives are acceptable
// (a civilian term may rarely show as UNKNOWN); false negatives are impossible.

// MurmurHash3-style 32-bit hash with a seed parameter. Properly mixes all
// 16 bits of each JS char code so Hebrew (U+0590–U+05EA) distributes well.
function murmur3(str: string, seed: number): number {
  let h = seed >>> 0;
  for (let i = 0; i < str.length; i++) {
    let k = str.charCodeAt(i);
    k = Math.imul(k, 0xcc9e2d51);
    k = (k << 15) | (k >>> 17);
    k = Math.imul(k, 0x1b873593);
    h ^= k;
    h = (h << 13) | (h >>> 19);
    h = Math.imul(h, 5) + 0xe6546b64;
  }
  h ^= str.length;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

export class BloomFilter {
  readonly size: number;
  readonly hashes: number;
  private readonly bits: Uint8Array;

  constructor(size: number, hashes: number, bits?: Uint8Array) {
    this.size = size;
    this.hashes = hashes;
    this.bits = bits ?? new Uint8Array(Math.ceil(size / 8));
  }

  // Optimal parameters for n items at target false-positive rate p.
  static optimal(n: number, p = 0.001): { size: number; hashes: number } {
    const size = Math.ceil((-n * Math.log(p)) / (Math.LN2 * Math.LN2));
    const hashes = Math.max(1, Math.round((size / n) * Math.LN2));
    return { size, hashes };
  }

  private *indexes(item: string): Generator<number> {
    const h1 = murmur3(item, 0);
    const h2 = murmur3(item, 0x9747b28c) | 1; // ensure odd
    for (let i = 0; i < this.hashes; i++) {
      yield ((h1 + Math.imul(i, h2)) >>> 0) % this.size;
    }
  }

  add(item: string): void {
    for (const idx of this.indexes(item)) {
      this.bits[idx >>> 3] |= 1 << (idx & 7);
    }
  }

  has(item: string): boolean {
    for (const idx of this.indexes(item)) {
      if ((this.bits[idx >>> 3] & (1 << (idx & 7))) === 0) return false;
    }
    return true;
  }

  toBase64(): string {
    // Works in both Node (Buffer) and the browser (btoa).
    if (typeof Buffer !== 'undefined') {
      return Buffer.from(this.bits).toString('base64');
    }
    let binary = '';
    for (let i = 0; i < this.bits.length; i++) binary += String.fromCharCode(this.bits[i]);
    return btoa(binary);
  }

  static fromBase64(base64: string, size: number, hashes: number): BloomFilter {
    let bytes: Uint8Array;
    if (typeof Buffer !== 'undefined') {
      bytes = new Uint8Array(Buffer.from(base64, 'base64'));
    } else {
      const binary = atob(base64);
      bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    }
    return new BloomFilter(size, hashes, bytes);
  }
}
