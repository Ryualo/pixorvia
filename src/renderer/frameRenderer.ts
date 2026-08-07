/**
 * Frame Renderer - Convert packets to visual frames
 */

import type { Packet, Frame } from '../protocol/types';
import { FRAME_SIZE, FINDER_SIZE, TIMING_WIDTH, CELL_SIZE } from '../protocol/types';
import { serializePacket } from '../encoder/packetizer';

/**
 * Generate visual frame from packet
 */
export function generateFrame(packet: Packet, frameId: number): Frame {
  const canvas = new OffscreenCanvas(FRAME_SIZE, FRAME_SIZE);
  const ctx = canvas.getContext('2d');
  
  if (!ctx) {
    throw new Error('Failed to get canvas context');
  }
  
  // Clear canvas
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, FRAME_SIZE, FRAME_SIZE);
  
  // Draw finder patterns (corner markers)
  drawFinderPatterns(ctx);
  
  // Draw timing patterns
  drawTimingPatterns(ctx);
  
  // Draw orientation marker
  drawOrientationMarker(ctx);
  
  // Encode and draw data
  const packetData = serializePacket(packet);
  drawDataRegion(ctx, packetData);
  
  // Get image data
  const imageData = ctx.getImageData(0, 0, FRAME_SIZE, FRAME_SIZE);
  
  return {
    id: frameId,
    packet,
    imageData,
    timestamp: Date.now(),
  };
}

/**
 * Draw finder patterns in corners
 */
function drawFinderPatterns(ctx: OffscreenCanvasRenderingContext2D) {
  const positions = [
    [0, 0], // Top-left
    [FRAME_SIZE - FINDER_SIZE, 0], // Top-right
    [0, FRAME_SIZE - FINDER_SIZE], // Bottom-left
  ];
  
  ctx.fillStyle = '#000000';
  
  for (const [x, y] of positions) {
    // Outer square
    ctx.fillRect(x, y, FINDER_SIZE, FINDER_SIZE);
    
    // Inner white square
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(x + 8, y + 8, FINDER_SIZE - 16, FINDER_SIZE - 16);
    
    // Center black square
    ctx.fillStyle = '#000000';
    ctx.fillRect(x + 16, y + 16, FINDER_SIZE - 32, FINDER_SIZE - 32);
  }
}

/**
 * Draw timing patterns for synchronization
 */
function drawTimingPatterns(ctx: OffscreenCanvasRenderingContext2D) {
  ctx.fillStyle = '#000000';
  
  // Horizontal timing pattern
  for (let i = FINDER_SIZE; i < FRAME_SIZE - FINDER_SIZE; i += TIMING_WIDTH * 2) {
    ctx.fillRect(i, FINDER_SIZE - TIMING_WIDTH, TIMING_WIDTH, TIMING_WIDTH);
  }
  
  // Vertical timing pattern
  for (let i = FINDER_SIZE; i < FRAME_SIZE - FINDER_SIZE; i += TIMING_WIDTH * 2) {
    ctx.fillRect(FINDER_SIZE - TIMING_WIDTH, i, TIMING_WIDTH, TIMING_WIDTH);
  }
}

/**
 * Draw orientation marker (bottom-right corner)
 */
function drawOrientationMarker(ctx: OffscreenCanvasRenderingContext2D) {
  const x = FRAME_SIZE - FINDER_SIZE;
  const y = FRAME_SIZE - FINDER_SIZE;
  const size = FINDER_SIZE / 2;
  
  ctx.fillStyle = '#000000';
  ctx.fillRect(x, y, size, size);
}

/**
 * Draw data region with packet bytes
 */
function drawDataRegion(ctx: OffscreenCanvasRenderingContext2D, data: Uint8Array) {
  const startX = FINDER_SIZE + TIMING_WIDTH;
  const startY = FINDER_SIZE + TIMING_WIDTH;
  const maxX = FRAME_SIZE - FINDER_SIZE - TIMING_WIDTH;
  const maxY = FRAME_SIZE - FINDER_SIZE - TIMING_WIDTH;
  
  let byteIndex = 0;
  let bitIndex = 0;
  
  for (let y = startY; y < maxY && byteIndex < data.length; y += CELL_SIZE) {
    for (let x = startX; x < maxX && byteIndex < data.length; x += CELL_SIZE) {
      // Get current bit
      const byte = data[byteIndex];
      const bit = (byte >> (7 - bitIndex)) & 1;
      
      // Draw cell
      ctx.fillStyle = bit === 1 ? '#000000' : '#FFFFFF';
      ctx.fillRect(x, y, CELL_SIZE, CELL_SIZE);
      
      // Move to next bit
      bitIndex++;
      if (bitIndex >= 8) {
        bitIndex = 0;
        byteIndex++;
      }
    }
  }
}

/**
 * Render frame to canvas for display
 */
export function renderFrameToCanvas(frame: Frame, canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  
  canvas.width = FRAME_SIZE;
  canvas.height = FRAME_SIZE;
  
  ctx.putImageData(frame.imageData, 0, 0);
}

/**
 * Create animation sequence from packets
 */
export function createFrameSequence(packets: Packet[]): Frame[] {
  return packets.map((packet, index) => generateFrame(packet, index));
}

/**
 * Optimize frame for high contrast
 */
export function optimizeFrame(imageData: ImageData): ImageData {
  const data = imageData.data;
  
  for (let i = 0; i < data.length; i += 4) {
    const gray = (data[i] + data[i + 1] + data[i + 2]) / 3;
    const value = gray > 128 ? 255 : 0;
    
    data[i] = value;     // R
    data[i + 1] = value; // G
    data[i + 2] = value; // B
    data[i + 3] = 255;   // A
  }
  
  return imageData;
}

/**
 * Add error correction visual markers
 */
export function addErrorCorrectionMarkers(ctx: OffscreenCanvasRenderingContext2D, level: number) {
  const markerSize = 4;
  const x = FRAME_SIZE - FINDER_SIZE - 20;
  const y = 10;
  
  ctx.fillStyle = '#000000';
  
  for (let i = 0; i < level; i++) {
    ctx.fillRect(x + i * (markerSize + 2), y, markerSize, markerSize);
  }
}

/**
 * Calculate data capacity for frame
 */
export function calculateFrameCapacity(): number {
  const dataWidth = FRAME_SIZE - 2 * (FINDER_SIZE + TIMING_WIDTH);
  const dataHeight = FRAME_SIZE - 2 * (FINDER_SIZE + TIMING_WIDTH);
  const cellsX = Math.floor(dataWidth / CELL_SIZE);
  const cellsY = Math.floor(dataHeight / CELL_SIZE);
  const totalBits = cellsX * cellsY;
  return Math.floor(totalBits / 8); // Convert to bytes
}

/**
 * Create calibration frame for camera adjustment
 */
export function createCalibrationFrame(): ImageData {
  const canvas = new OffscreenCanvas(FRAME_SIZE, FRAME_SIZE);
  const ctx = canvas.getContext('2d');
  
  if (!ctx) {
    throw new Error('Failed to get canvas context');
  }
  
  // White background
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, FRAME_SIZE, FRAME_SIZE);
  
  // Black border
  ctx.fillStyle = '#000000';
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 4;
  ctx.strokeRect(0, 0, FRAME_SIZE, FRAME_SIZE);
  
  // Checkerboard pattern
  const cellSize = 32;
  for (let y = 0; y < FRAME_SIZE; y += cellSize) {
    for (let x = 0; x < FRAME_SIZE; x += cellSize) {
      if ((x / cellSize + y / cellSize) % 2 === 0) {
        ctx.fillRect(x, y, cellSize, cellSize);
      }
    }
  }
  
  // Draw finder patterns
  drawFinderPatterns(ctx);
  
  return ctx.getImageData(0, 0, FRAME_SIZE, FRAME_SIZE);
}
