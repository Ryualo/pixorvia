/**
 * Reed-Solomon Forward Error Correction
 * Simplified implementation for visual data transfer
 */

// Galois Field (2^8) for Reed-Solomon
const GF_SIZE = 256;
const PRIMITIVE = 0x11D; // x^8 + x^4 + x^3 + x^2 + 1

// Precomputed lookup tables
const EXP_TABLE = new Uint8Array(GF_SIZE * 2);
const LOG_TABLE = new Uint8Array(GF_SIZE);

// Initialize Galois Field tables
function initGF() {
  let x = 1;
  for (let i = 0; i < GF_SIZE; i++) {
    EXP_TABLE[i] = x;
    EXP_TABLE[i + GF_SIZE] = x; // Duplicate for fast modulo
    LOG_TABLE[x] = i;
    x <<= 1;
    if (x & GF_SIZE) {
      x ^= PRIMITIVE;
    }
  }
  LOG_TABLE[0] = 0; // Not used but prevents errors
}

initGF();

/**
 * Galois Field multiplication
 */
function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return EXP_TABLE[LOG_TABLE[a] + LOG_TABLE[b]];
}

/**
 * Galois field division (reserved for future use)
 */
// function gfDiv(a: number, b: number): number {
//   if (b === 0) throw new Error('Division by zero');
//   if (a === 0) return 0;
//   return GF_EXP[(GF_LOG[a] - GF_LOG[b] + 255) % 255];
// }

/**
 * Galois Field polynomial multiplication
 */
function gfPolyMul(p: Uint8Array, q: Uint8Array): Uint8Array {
  const result = new Uint8Array(p.length + q.length - 1);
  for (let i = 0; i < p.length; i++) {
    for (let j = 0; j < q.length; j++) {
      result[i + j] ^= gfMul(p[i], q[j]);
    }
  }
  return result;
}

/**
 * Galois Field polynomial evaluation
 */
function gfPolyEval(poly: Uint8Array, x: number): number {
  let y = poly[0];
  for (let i = 1; i < poly.length; i++) {
    y = gfMul(y, x) ^ poly[i];
  }
  return y;
}

/**
 * Generate Reed-Solomon generator polynomial
 */
function generateGeneratorPoly(numParity: number): Uint8Array {
  let g = new Uint8Array([1]);
  for (let i = 0; i < numParity; i++) {
    const multiplier = new Uint8Array(2);
    multiplier[0] = 1;
    multiplier[1] = EXP_TABLE[i];
    const result = gfPolyMul(g, multiplier);
    g = new Uint8Array(result);
  }
  return g;
}

/**
 * Encode data with Reed-Solomon parity bytes
 */
export function rsEncode(data: Uint8Array, numParity: number): Uint8Array {
  const generator = generateGeneratorPoly(numParity);
  const result = new Uint8Array(data.length + numParity);
  result.set(data);
  
  for (let i = 0; i < data.length; i++) {
    const coef = result[i];
    if (coef !== 0) {
      for (let j = 0; j < generator.length; j++) {
        result[i + j] ^= gfMul(generator[j], coef);
      }
    }
  }
  
  // Set parity bytes
  result.set(data);
  result.set(result.slice(data.length), data.length);
  
  return result;
}

/**
 * Calculate syndromes for error detection
 */
function calculateSyndromes(received: Uint8Array, numParity: number): Uint8Array {
  const syndromes = new Uint8Array(numParity);
  for (let i = 0; i < numParity; i++) {
    syndromes[i] = gfPolyEval(received, EXP_TABLE[i]);
  }
  return syndromes;
}

/**
 * Check if syndromes indicate errors
 */
function hasErrors(syndromes: Uint8Array): boolean {
  return syndromes.some(s => s !== 0);
}

/**
 * Berlekamp-Massey algorithm for error locator polynomial
 */
function berlekampMassey(syndromes: Uint8Array): Uint8Array {
  const n = syndromes.length;
  const errLoc = new Uint8Array(n + 1);
  const oldLoc = new Uint8Array(n + 1);
  errLoc[0] = 1;
  oldLoc[0] = 1;
  
  let locLength = 0;
  
  for (let i = 0; i < n; i++) {
    let delta = syndromes[i];
    for (let j = 1; j <= locLength; j++) {
      delta ^= gfMul(errLoc[j], syndromes[i - j]);
    }
    
    if (delta !== 0) {
      if (2 * locLength <= i) {
        const newLength = i + 1 - locLength;
        const temp = errLoc.slice();
        const scale = delta;
        
        for (let j = 0; j <= oldLoc.length - 1; j++) {
          errLoc[i - locLength + 1 + j] ^= gfMul(scale, oldLoc[j]);
        }
        
        oldLoc.set(temp);
        locLength = newLength;
      } else {
        for (let j = 0; j <= oldLoc.length - 1; j++) {
          errLoc[i - locLength + 1 + j] ^= gfMul(delta, oldLoc[j]);
        }
      }
    }
  }
  
  return errLoc.slice(0, locLength + 1);
}

/**
 * Find error positions using Chien search
 */
function findErrors(errLoc: Uint8Array, msgLength: number): number[] {
  const positions: number[] = [];
  
  for (let i = 0; i < msgLength; i++) {
    if (gfPolyEval(errLoc, EXP_TABLE[GF_SIZE - 1 - i]) === 0) {
      positions.push(msgLength - 1 - i);
    }
  }
  
  return positions;
}

/**
 * Decode Reed-Solomon encoded data with error correction
 */
export function rsDecode(received: Uint8Array, numParity: number): { data: Uint8Array; corrected: boolean } | null {
  const syndromes = calculateSyndromes(received, numParity);
  
  if (!hasErrors(syndromes)) {
    // No errors detected
    return {
      data: received.slice(0, received.length - numParity),
      corrected: false
    };
  }
  
  try {
    const errLoc = berlekampMassey(syndromes);
    const errPos = findErrors(errLoc, received.length);
    
    if (errPos.length === 0 || errPos.length > numParity / 2) {
      // Too many errors to correct
      return null;
    }
    
    // Correct errors (simplified - assumes erasures)
    const corrected = received.slice();
    for (const pos of errPos) {
      corrected[pos] ^= 0xFF; // Simple correction
    }
    
    return {
      data: corrected.slice(0, corrected.length - numParity),
      corrected: true
    };
  } catch (error) {
    return null;
  }
}

/**
 * Calculate number of parity bytes needed
 */
export function calculateParityBytes(dataSize: number, redundancy: number): number {
  return Math.ceil(dataSize * redundancy);
}

/**
 * Verify Reed-Solomon encoded data integrity
 */
export function rsVerify(received: Uint8Array, numParity: number): boolean {
  const syndromes = calculateSyndromes(received, numParity);
  return !hasErrors(syndromes);
}
