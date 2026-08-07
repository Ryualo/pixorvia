/**
 * File compression using pako (zlib)
 */

import * as pako from 'pako';

/**
 * Compress data using deflate
 */
export function compressData(data: Uint8Array, level = 6): Uint8Array {
  return pako.deflate(data, { level });
}

/**
 * Decompress data
 */
export function decompressData(data: Uint8Array): Uint8Array {
  return pako.inflate(data);
}

/**
 * Compress file for transfer
 */
export async function compressFile(file: File, level = 6): Promise<Uint8Array> {
  const arrayBuffer = await file.arrayBuffer();
  const data = new Uint8Array(arrayBuffer);
  return compressData(data, level);
}

/**
 * Calculate compression ratio
 */
export function getCompressionRatio(originalSize: number, compressedSize: number): number {
  return compressedSize / originalSize;
}
