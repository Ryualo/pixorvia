/**
 * Frame Decoder - Extract packets from visual frames
 */

import type { DecodeResult } from '../protocol/types';
import { FRAME_SIZE, FINDER_SIZE, TIMING_WIDTH, CELL_SIZE } from '../protocol/types';
import { deserializePacket, verifyPacket } from '../encoder/packetizer';
import { rsDecode } from '../fec/reedsolomon';

/**
 * Detect frame in image
 */
export function detectFrame(imageData: ImageData): { detected: boolean; corners?: [number, number][] } {
  const corners = findFinderPatterns(imageData);
  
  if (corners.length >= 3) {
    return { detected: true, corners };
  }
  
  return { detected: false };
}

/**
 * Find finder patterns in image
 */
function findFinderPatterns(imageData: ImageData): [number, number][] {
  const corners: [number, number][] = [];
  const { width, height } = imageData;
  const minSize = 32;
  const maxSize = 128;
  
  // Scan image for finder patterns
  for (let y = 0; y < height - minSize; y += 4) {
    for (let x = 0; x < width - minSize; x += 4) {
      if (isFinderPattern(imageData, x, y, minSize, maxSize)) {
        corners.push([x, y]);
        x += maxSize; // Skip ahead
      }
    }
  }
  
  return corners;
}

/**
 * Check if region contains finder pattern
 */
function isFinderPattern(imageData: ImageData, x: number, y: number, minSize: number, maxSize: number): boolean {
  const { width, data } = imageData;
  const size = Math.min(maxSize, Math.min(imageData.width - x, imageData.height - y));
  
  if (size < minSize) return false;
  
  // Sample corners and center
  const corners = [
    getPixelBrightness(data, x, y, width),
    getPixelBrightness(data, x + size - 1, y, width),
    getPixelBrightness(data, x, y + size - 1, width),
    getPixelBrightness(data, x + size - 1, y + size - 1, width),
  ];
  
  const center = getPixelBrightness(data, x + Math.floor(size / 2), y + Math.floor(size / 2), width);
  
  // Finder pattern should have dark corners and dark center
  const avgCorner = corners.reduce((a, b) => a + b, 0) / corners.length;
  
  return avgCorner < 100 && center < 100;
}

/**
 * Get pixel brightness
 */
function getPixelBrightness(data: Uint8ClampedArray, x: number, y: number, width: number): number {
  const index = (y * width + x) * 4;
  return (data[index] + data[index + 1] + data[index + 2]) / 3;
}

/**
 * Apply perspective correction
 */
export function correctPerspective(imageData: ImageData, corners: [number, number][]): ImageData {
  if (corners.length < 3) return imageData;
  
  // Create output canvas
  const canvas = new OffscreenCanvas(FRAME_SIZE, FRAME_SIZE);
  const ctx = canvas.getContext('2d');
  
  if (!ctx) return imageData;
  
  // For simplicity, we'll do basic scaling
  // In production, you'd want proper homography transformation
  const srcCanvas = new OffscreenCanvas(imageData.width, imageData.height);
  const srcCtx = srcCanvas.getContext('2d');
  if (!srcCtx) return imageData;
  
  srcCtx.putImageData(imageData, 0, 0);
  
  // Find bounding box
  const minX = Math.min(...corners.map(c => c[0]));
  const minY = Math.min(...corners.map(c => c[1]));
  const maxX = Math.max(...corners.map(c => c[0]));
  const maxY = Math.max(...corners.map(c => c[1]));
  
  const srcWidth = maxX - minX;
  const srcHeight = maxY - minY;
  
  // Scale to target size
  ctx.drawImage(srcCanvas, minX, minY, srcWidth, srcHeight, 0, 0, FRAME_SIZE, FRAME_SIZE);
  
  return ctx.getImageData(0, 0, FRAME_SIZE, FRAME_SIZE);
}

/**
 * Apply adaptive thresholding
 */
export function applyThreshold(imageData: ImageData): ImageData {
  const data = imageData.data;
  const grayscale = new Uint8Array(imageData.width * imageData.height);
  
  // Convert to grayscale
  for (let i = 0; i < data.length; i += 4) {
    const gray = (data[i] + data[i + 1] + data[i + 2]) / 3;
    grayscale[i / 4] = gray;
  }
  
  // Apply Otsu's method for thresholding
  const threshold = calculateOtsuThreshold(grayscale);
  
  // Apply threshold
  for (let i = 0; i < data.length; i += 4) {
    const value = grayscale[i / 4] > threshold ? 255 : 0;
    data[i] = value;
    data[i + 1] = value;
    data[i + 2] = value;
  }
  
  return imageData;
}

/**
 * Calculate Otsu threshold
 */
function calculateOtsuThreshold(grayscale: Uint8Array): number {
  const histogram = new Uint32Array(256);
  
  // Build histogram
  for (let i = 0; i < grayscale.length; i++) {
    histogram[grayscale[i]]++;
  }
  
  const total = grayscale.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) {
    sum += i * histogram[i];
  }
  
  let sumB = 0;
  let wB = 0;
  let wF = 0;
  let maxVariance = 0;
  let threshold = 0;
  
  for (let i = 0; i < 256; i++) {
    wB += histogram[i];
    if (wB === 0) continue;
    
    wF = total - wB;
    if (wF === 0) break;
    
    sumB += i * histogram[i];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const variance = wB * wF * (mB - mF) * (mB - mF);
    
    if (variance > maxVariance) {
      maxVariance = variance;
      threshold = i;
    }
  }
  
  return threshold;
}

/**
 * Extract data from frame
 */
export function extractDataFromFrame(imageData: ImageData): Uint8Array | null {
  const startX = FINDER_SIZE + TIMING_WIDTH;
  const startY = FINDER_SIZE + TIMING_WIDTH;
  const maxX = FRAME_SIZE - FINDER_SIZE - TIMING_WIDTH;
  const maxY = FRAME_SIZE - FINDER_SIZE - TIMING_WIDTH;
  
  const bits: number[] = [];
  const { data, width } = imageData;
  
  for (let y = startY; y < maxY; y += CELL_SIZE) {
    for (let x = startX; x < maxX; x += CELL_SIZE) {
      // Sample center of cell
      const centerX = x + Math.floor(CELL_SIZE / 2);
      const centerY = y + Math.floor(CELL_SIZE / 2);
      
      if (centerX >= width || centerY >= imageData.height) continue;
      
      const index = (centerY * width + centerX) * 4;
      const brightness = (data[index] + data[index + 1] + data[index + 2]) / 3;
      
      bits.push(brightness < 128 ? 1 : 0);
    }
  }
  
  // Convert bits to bytes
  const bytes = new Uint8Array(Math.floor(bits.length / 8));
  for (let i = 0; i < bytes.length; i++) {
    let byte = 0;
    for (let j = 0; j < 8; j++) {
      byte = (byte << 1) | bits[i * 8 + j];
    }
    bytes[i] = byte;
  }
  
  return bytes;
}

/**
 * Decode packet from frame
 */
export function decodeFrame(imageData: ImageData): DecodeResult {
  try {
    // Apply preprocessing
    const thresholded = applyThreshold(imageData);
    
    // Extract data
    const data = extractDataFromFrame(thresholded);
    
    if (!data) {
      return { success: false, error: 'Failed to extract data' };
    }
    
    // Deserialize packet
    const packet = deserializePacket(data);
    
    if (!packet) {
      return { success: false, error: 'Failed to deserialize packet' };
    }
    
    // Verify packet integrity
    if (!verifyPacket(packet)) {
      // Try error correction
      const corrected = rsDecode(
        new Uint8Array([...packet.payload, ...packet.parity]),
        packet.header.parityBytes
      );
      
      if (corrected) {
        packet.payload = corrected.data;
        return { success: true, packet };
      }
      
      return { success: false, error: 'Packet verification failed' };
    }
    
    return { success: true, packet };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

/**
 * Calculate signal quality from frame
 */
export function calculateSignalQuality(imageData: ImageData): number {
  const corners = findFinderPatterns(imageData);
  const baseQuality = Math.min(corners.length / 3, 1) * 100;
  
  // Check contrast
  const { data } = imageData;
  let minBrightness = 255;
  let maxBrightness = 0;
  
  for (let i = 0; i < data.length; i += 4) {
    const brightness = (data[i] + data[i + 1] + data[i + 2]) / 3;
    minBrightness = Math.min(minBrightness, brightness);
    maxBrightness = Math.max(maxBrightness, brightness);
  }
  
  const contrast = (maxBrightness - minBrightness) / 255;
  
  return baseQuality * contrast;
}
