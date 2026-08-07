/**
 * Decoder Worker - Background decoding of frames to file
 */

import type { Packet } from '../protocol/types';
import { WorkerMessageType } from '../protocol/types';
import { decodeFrame, calculateSignalQuality } from '../decoder/frameDecoder';
import { reassemblePackets } from '../encoder/packetizer';
import { decompressData } from '../compression/compress';

/**
 * Handle messages from main thread
 */
self.onmessage = async (e: MessageEvent) => {
  const { type, data } = e.data;

  try {
    switch (type) {
      case WorkerMessageType.DECODE:
        await handleDecode(data);
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
 * Handle frame decoding
 */
async function handleDecode(data: { imageData: ImageData }) {
  const { imageData } = data;
  
  // Calculate signal quality
  const signalQuality = calculateSignalQuality(imageData);
  
  self.postMessage({
    type: WorkerMessageType.PROGRESS,
    data: {
      stage: 'analyzing',
      signalQuality,
    },
  });
  
  // Decode frame
  const result = decodeFrame(imageData);
  
  if (!result.success) {
    self.postMessage({
      type: WorkerMessageType.ERROR,
      error: result.error || 'Decode failed',
    });
    return;
  }
  
  // Send decoded packet
  self.postMessage({
    type: WorkerMessageType.RESULT,
    data: {
      packet: result.packet,
      signalQuality,
    },
  });
}

/**
 * Reassemble and decompress file
 */
self.addEventListener('message', async (e: MessageEvent) => {
  const { type, data } = e.data;
  
  if (type === 'reassemble') {
    try {
      const { packets } = data as { packets: Packet[] };
      
      // Reassemble packets
      self.postMessage({
        type: WorkerMessageType.PROGRESS,
        data: { stage: 'reassembling' },
      });
      
      const compressed = reassemblePackets(packets);
      
      if (!compressed) {
        self.postMessage({
          type: WorkerMessageType.ERROR,
          error: 'Failed to reassemble packets',
        });
        return;
      }
      
      // Decompress
      self.postMessage({
        type: WorkerMessageType.PROGRESS,
        data: { stage: 'decompressing' },
      });
      
      const decompressed = decompressData(compressed);
      
      // Send result
      self.postMessage({
        type: WorkerMessageType.RESULT,
        data: {
          fileData: decompressed.buffer,
        },
      });
    } catch (error) {
      self.postMessage({
        type: WorkerMessageType.ERROR,
        error: String(error),
      });
    }
  }
});

export {};
