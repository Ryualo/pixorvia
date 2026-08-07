/**
 * CRC32 implementation for data integrity checking
 */

// CRC32 lookup table
const CRC32_TABLE = new Uint32Array(256);

// Initialize CRC32 table
for (let i = 0; i < 256; i++) {
  let crc = i;
  for (let j = 0; j < 8; j++) {
    crc = (crc & 1) ? (0xEDB88320 ^ (crc >>> 1)) : (crc >>> 1);
  }
  CRC32_TABLE[i] = crc;
}

/**
 * Calculate CRC32 checksum for data
 */
export function crc32(data: Uint8Array): number {
  let crc = 0xFFFFFFFF;
  
  for (let i = 0; i < data.length; i++) {
    const byte = data[i];
    crc = CRC32_TABLE[(crc ^ byte) & 0xFF] ^ (crc >>> 8);
  }
  
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

/**
 * Verify CRC32 checksum
 */
export function verifyCRC32(data: Uint8Array, expectedCRC: number): boolean {
  return crc32(data) === expectedCRC;
}

/**
 * Calculate checksum for file metadata
 */
export function calculateFileChecksum(data: Uint8Array): number {
  return crc32(data);
}
