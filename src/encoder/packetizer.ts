/**
 * Packetizer - Split data into packets for transmission
 */

import type { Packet, PacketHeader } from '../protocol/types';
import { PROTOCOL_VERSION, DEFAULT_PACKET_SIZE, REED_SOLOMON_REDUNDANCY } from '../protocol/types';
import { crc32 } from '../utils/crc32';
import { rsEncode, calculateParityBytes } from '../fec/reedsolomon';

/**
 * Split data into packets
 */
export function createPackets(
  data: Uint8Array,
  packetSize: number = DEFAULT_PACKET_SIZE,
  redundancy: number = REED_SOLOMON_REDUNDANCY
): Packet[] {
  const packets: Packet[] = [];
  const totalPackets = Math.ceil(data.length / packetSize);
  
  for (let i = 0; i < totalPackets; i++) {
    const start = i * packetSize;
    const end = Math.min(start + packetSize, data.length);
    const payload = data.slice(start, end);
    
    // Calculate parity bytes
    const parityBytes = calculateParityBytes(payload.length, redundancy);
    
    // Encode with Reed-Solomon
    const encoded = rsEncode(payload, parityBytes);
    const parity = encoded.slice(payload.length);
    
    // Create header
    const header: PacketHeader = {
      version: PROTOCOL_VERSION,
      frameId: i,
      packetNumber: i,
      totalPackets,
      payloadSize: payload.length,
      timestamp: Date.now(),
      checksum: crc32(payload),
      parityBytes,
    };
    
    // Calculate packet CRC
    const packetCRC = calculatePacketCRC(header, payload, parity);
    
    packets.push({
      header,
      payload,
      parity,
      crc32: packetCRC,
    });
  }
  
  return packets;
}

/**
 * Calculate CRC for entire packet
 */
function calculatePacketCRC(header: PacketHeader, payload: Uint8Array, parity: Uint8Array): number {
  const headerBytes = serializeHeader(header);
  const combined = new Uint8Array(headerBytes.length + payload.length + parity.length);
  combined.set(headerBytes, 0);
  combined.set(payload, headerBytes.length);
  combined.set(parity, headerBytes.length + payload.length);
  return crc32(combined);
}

/**
 * Serialize packet header to bytes
 */
export function serializeHeader(header: PacketHeader): Uint8Array {
  const buffer = new Uint8Array(32); // Fixed header size
  const view = new DataView(buffer.buffer);
  
  view.setUint8(0, header.version);
  view.setUint32(1, header.frameId, false);
  view.setUint32(5, header.packetNumber, false);
  view.setUint32(9, header.totalPackets, false);
  view.setUint16(13, header.payloadSize, false);
  view.setFloat64(15, header.timestamp, false);
  view.setUint32(23, header.checksum, false);
  view.setUint8(27, header.parityBytes);
  
  return buffer;
}

/**
 * Deserialize packet header from bytes
 */
export function deserializeHeader(buffer: Uint8Array): PacketHeader {
  const view = new DataView(buffer.buffer, buffer.byteOffset);
  
  return {
    version: view.getUint8(0),
    frameId: view.getUint32(1, false),
    packetNumber: view.getUint32(5, false),
    totalPackets: view.getUint32(9, false),
    payloadSize: view.getUint16(13, false),
    timestamp: view.getFloat64(15, false),
    checksum: view.getUint32(23, false),
    parityBytes: view.getUint8(27),
  };
}

/**
 * Serialize packet to bytes for transmission
 */
export function serializePacket(packet: Packet): Uint8Array {
  const headerBytes = serializeHeader(packet.header);
  const totalSize = headerBytes.length + packet.payload.length + packet.parity.length + 4; // +4 for CRC
  
  const buffer = new Uint8Array(totalSize);
  const view = new DataView(buffer.buffer);
  
  let offset = 0;
  
  // Header
  buffer.set(headerBytes, offset);
  offset += headerBytes.length;
  
  // Payload
  buffer.set(packet.payload, offset);
  offset += packet.payload.length;
  
  // Parity
  buffer.set(packet.parity, offset);
  offset += packet.parity.length;
  
  // CRC32
  view.setUint32(offset, packet.crc32, false);
  
  return buffer;
}

/**
 * Deserialize packet from bytes
 */
export function deserializePacket(buffer: Uint8Array): Packet | null {
  try {
    if (buffer.length < 36) return null; // Minimum size
    
    const header = deserializeHeader(buffer.slice(0, 32));
    let offset = 32;
    
    const payload = buffer.slice(offset, offset + header.payloadSize);
    offset += header.payloadSize;
    
    const parity = buffer.slice(offset, offset + header.parityBytes);
    offset += header.parityBytes;
    
    const view = new DataView(buffer.buffer, buffer.byteOffset + offset);
    const crc32Value = view.getUint32(0, false);
    
    return {
      header,
      payload,
      parity,
      crc32: crc32Value,
    };
  } catch (error) {
    return null;
  }
}

/**
 * Verify packet integrity
 */
export function verifyPacket(packet: Packet): boolean {
  const expectedCRC = calculatePacketCRC(packet.header, packet.payload, packet.parity);
  return expectedCRC === packet.crc32;
}

/**
 * Reassemble packets into original data
 */
export function reassemblePackets(packets: Packet[]): Uint8Array | null {
  if (packets.length === 0) return null;
  
  // Sort by packet number
  const sorted = [...packets].sort((a, b) => a.header.packetNumber - b.header.packetNumber);
  
  // Check for missing packets
  const totalPackets = sorted[0].header.totalPackets;
  if (sorted.length !== totalPackets) return null;
  
  // Calculate total size
  let totalSize = 0;
  for (const packet of sorted) {
    totalSize += packet.header.payloadSize;
  }
  
  // Reassemble
  const result = new Uint8Array(totalSize);
  let offset = 0;
  
  for (const packet of sorted) {
    result.set(packet.payload, offset);
    offset += packet.header.payloadSize;
  }
  
  return result;
}
