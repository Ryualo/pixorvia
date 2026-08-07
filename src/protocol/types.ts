/**
 * Protocol Types and Constants for PixorGrid
 * Visual data transfer protocol definitions
 */

export const PROTOCOL_VERSION = 1;

// Frame configuration
export const FRAME_SIZE = 512; // pixels per side
export const FINDER_SIZE = 64; // corner marker size
export const TIMING_WIDTH = 8; // timing pattern width
export const MIN_PACKET_SIZE = 256;
export const MAX_PACKET_SIZE = 2048;
export const DEFAULT_PACKET_SIZE = 1024;

// Error correction
export const REED_SOLOMON_REDUNDANCY = 0.2; // 20% redundancy
export const MAX_RETRIES = 3;

// Frame rate and timing
export const TARGET_FPS = 60;
export const MIN_FPS = 10;
export const FRAME_HOLD_TIME = 16; // ms per frame at 60fps

// Visual encoding
export const CELL_SIZE = 4; // pixels per data cell
export const CELLS_PER_ROW = Math.floor((FRAME_SIZE - 2 * FINDER_SIZE) / CELL_SIZE);
export const DATA_CELLS = CELLS_PER_ROW * CELLS_PER_ROW;

// Packet structure
export interface PacketHeader {
  version: number;
  frameId: number;
  packetNumber: number;
  totalPackets: number;
  payloadSize: number;
  timestamp: number;
  checksum: number;
  parityBytes: number;
}

export interface Packet {
  header: PacketHeader;
  payload: Uint8Array;
  parity: Uint8Array;
  crc32: number;
}

export interface Frame {
  id: number;
  packet: Packet;
  imageData: ImageData;
  timestamp: number;
}

// File metadata
export interface FileMetadata {
  name: string;
  size: number;
  type: string;
  lastModified: number;
  checksum: number;
}

// Transfer state
export interface TransferState {
  fileMetadata: FileMetadata;
  totalPackets: number;
  receivedPackets: Set<number>;
  packets: Map<number, Uint8Array>;
  startTime: number;
  bytesTransferred: number;
  currentFPS: number;
  errors: number;
}

// Statistics
export interface TransferStats {
  fps: number;
  packetsSent: number;
  packetsReceived: number;
  totalPackets: number;
  bytesTransferred: number;
  totalBytes: number;
  progress: number;
  elapsedTime: number;
  estimatedTimeRemaining: number;
  errorRate: number;
  signalQuality: number;
}

// Frame detection result
export interface DetectionResult {
  detected: boolean;
  corners?: [number, number][];
  confidence: number;
  frame?: ImageData;
}

// Decoder result
export interface DecodeResult {
  success: boolean;
  packet?: Packet;
  error?: string;
}

// Camera configuration
export interface CameraConfig {
  width: number;
  height: number;
  frameRate: number;
  facingMode: 'user' | 'environment';
}

// Encoder configuration
export interface EncoderConfig {
  packetSize: number;
  fps: number;
  redundancy: number;
  compressionLevel: number;
}

// Visual mode
export const VisualMode = {
  MONOCHROME: 'monochrome',
  RGB: 'rgb',
} as const;
export type VisualMode = typeof VisualMode[keyof typeof VisualMode];

// Transfer status
export const TransferStatus = {
  IDLE: 'idle',
  PREPARING: 'preparing',
  TRANSFERRING: 'transferring',
  PAUSED: 'paused',
  COMPLETED: 'completed',
  ERROR: 'error',
} as const;
export type TransferStatus = typeof TransferStatus[keyof typeof TransferStatus];

// Message types for workers
export const WorkerMessageType = {
  ENCODE: 'encode',
  DECODE: 'decode',
  RESULT: 'result',
  ERROR: 'error',
  PROGRESS: 'progress',
} as const;
export type WorkerMessageType = typeof WorkerMessageType[keyof typeof WorkerMessageType];

export interface WorkerMessage {
  type: WorkerMessageType;
  data?: any;
  error?: string;
}
