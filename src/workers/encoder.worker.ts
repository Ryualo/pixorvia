/**
 * Encoder Worker - Background encoding of files to packets
 */

import type { FileMetadata, EncoderConfig } from '../protocol/types';
import { WorkerMessageType } from '../protocol/types';
import { compressData } from '../compression/compress';
import { createPackets } from '../encoder/packetizer';
import { calculateFileChecksum } from '../utils/crc32';

/**
 * Handle messages from main thread
 */
self.onmessage = async (e: MessageEvent) => {
  const { type, data } = e.data;

  try {
    switch (type) {
      case WorkerMessageType.ENCODE:
        await handleEncode(data);
        break;
      default:
        console.warn('Unknown message type:', type);
    }
  } catch (error) {
    self.postMessage({
      type: WorkerMessageType.ERROR,
      error: String(error),
    });
  }
};

/**
 * Handle file encoding
 */
async function handleEncode(data: {
  fileData: ArrayBuffer;
  fileName: string;
  fileType: string;
  lastModified: number;
  config: EncoderConfig;
}) {
  const { fileData, fileName, fileType, lastModified, config } = data;
  
  // Convert to Uint8Array
  const originalData = new Uint8Array(fileData);
  
  // Calculate checksum
  const checksum = calculateFileChecksum(originalData);
  
  // Create metadata
  const metadata: FileMetadata = {
    name: fileName,
    size: originalData.length,
    type: fileType,
    lastModified,
    checksum,
  };
  
  // Send metadata
  self.postMessage({
    type: WorkerMessageType.PROGRESS,
    data: {
      stage: 'metadata',
      metadata,
    },
  });
  
  // Compress data
  self.postMessage({
    type: WorkerMessageType.PROGRESS,
    data: { stage: 'compressing', progress: 0 },
  });
  
  const compressed = compressData(originalData, config.compressionLevel);
  
  self.postMessage({
    type: WorkerMessageType.PROGRESS,
    data: {
      stage: 'compressed',
      originalSize: originalData.length,
      compressedSize: compressed.length,
      ratio: compressed.length / originalData.length,
    },
  });
  
  // Create packets
  self.postMessage({
    type: WorkerMessageType.PROGRESS,
    data: { stage: 'packetizing', progress: 0 },
  });
  
  const packets = createPackets(compressed, config.packetSize, config.redundancy);
  
  self.postMessage({
    type: WorkerMessageType.PROGRESS,
    data: {
      stage: 'packetized',
      totalPackets: packets.length,
    },
  });
  
  // Send result
  self.postMessage({
    type: WorkerMessageType.RESULT,
    data: {
      metadata,
      packets: packets.map(p => ({
        header: p.header,
        payload: p.payload,
        parity: p.parity,
        crc32: p.crc32,
      })),
      compressed: compressed,
    },
  });
}

export {};
