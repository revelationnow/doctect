export interface HashWork {
  inputBytes: number; // Real message bytes, never padding.
  blocks: number; // Compression calls, including padding at finish.
  visits: number; // Copy bytes, schedule words, rounds, state words, hex words, release slots.
}

export interface HashFinish { digest: string; work: HashWork }

export interface NormalizationSha256 {
  update(bytes: Uint8Array): HashWork;
  finish(): HashFinish;
  dispose(): HashWork;
  retainedBytes(): number;
}

const INITIAL = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
  0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);
const rotr = (word: number, count: number) => (word >>> count) | (word << (32 - count));
const emptyWork = (): HashWork => ({ inputBytes: 0, blocks: 0, visits: 0 });

/** Private bounded stepping API; 192 input bytes cost at most 600 visits. */
export function createNormalizationSha256(): NormalizationSha256 {
  let state: Uint32Array | undefined = new Uint32Array(INITIAL);
  let schedule: Uint32Array | undefined = new Uint32Array(64);
  let block: Uint8Array | undefined = new Uint8Array(64);
  let used = 0;
  let bytesLow = 0;
  let bytesHigh = 0;
  const assertOpen = () => { if (!state) throw new Error('SHA-256 instance is closed'); };
  const compress = (work: HashWork) => {
    const h = state!;
    const w = schedule!;
    const b = block!;
    for (let i = 0; i < 16; i++) {
      const j = i * 4;
      w[i] = ((b[j] << 24) | (b[j + 1] << 16) | (b[j + 2] << 8) | b[j + 3]) >>> 0;
      work.visits++;
    }
    for (let i = 16; i < 64; i++) {
      const x = w[i - 15];
      const y = w[i - 2];
      const s0 = rotr(x, 7) ^ rotr(x, 18) ^ (x >>> 3);
      const s1 = rotr(y, 17) ^ rotr(y, 19) ^ (y >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
      work.visits++;
    }
    let [a, b0, c, d, e, f, g, h0] = h;
    for (let i = 0; i < 64; i++) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h0 + s1 + ch + K[i] + w[i]) >>> 0;
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b0) ^ (a & c) ^ (b0 & c);
      const t2 = (s0 + maj) >>> 0;
      h0 = g; g = f; f = e; e = (d + t1) >>> 0;
      d = c; c = b0; b0 = a; a = (t1 + t2) >>> 0;
      work.visits++;
    }
    const next = [a, b0, c, d, e, f, g, h0];
    for (let i = 0; i < 8; i++) { h[i] = (h[i] + next[i]) >>> 0; work.visits++; }
    used = 0;
    work.blocks++;
  };
  const append = (byte: number, work: HashWork) => {
    block![used++] = byte;
    work.visits++;
    if (used === 64) compress(work);
  };
  const dispose = (): HashWork => {
    const work = emptyWork();
    if (!state) return work;
    for (let i = 0; i < state.length; i++) { state[i] = 0; work.visits++; }
    for (let i = 0; i < schedule!.length; i++) { schedule![i] = 0; work.visits++; }
    for (let i = 0; i < block!.length; i++) { block![i] = 0; work.visits++; }
    state = undefined; schedule = undefined; block = undefined;
    used = 0; bytesLow = 0; bytesHigh = 0;
    return work;
  };
  return {
    update(bytes) {
      assertOpen();
      if (bytes.length > 192) throw new RangeError('SHA-256 update step exceeds 192 bytes');
      const work = emptyWork();
      work.inputBytes = bytes.length;
      const previous = bytesLow;
      bytesLow = (bytesLow + bytes.length) >>> 0;
      if (bytesLow < previous) bytesHigh = (bytesHigh + 1) >>> 0;
      for (let i = 0; i < bytes.length; i++) append(bytes[i], work);
      return work;
    },
    finish() {
      assertOpen();
      const work = emptyWork();
      // Encode the 64-bit bit length from two modulo-2^32 byte counters.
      const highBits = ((bytesHigh << 3) | (bytesLow >>> 29)) >>> 0;
      const lowBits = (bytesLow << 3) >>> 0;
      append(0x80, work);
      while (used !== 56) append(0, work);
      for (let shift = 24; shift >= 0; shift -= 8) append((highBits >>> shift) & 255, work);
      for (let shift = 24; shift >= 0; shift -= 8) append((lowBits >>> shift) & 255, work);
      let digest = '';
      for (let i = 0; i < 8; i++) { digest += state![i].toString(16).padStart(8, '0'); work.visits++; }
      work.visits += dispose().visits;
      return { digest, work };
    },
    dispose,
    // Owned buffer bytes only, not actual heap usage or a secure-erasure promise.
    retainedBytes: () => state ? 352 : 0,
  };
}
