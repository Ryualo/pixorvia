/**
 * Camera Capture - Access and process camera feed
 */

import type { CameraConfig } from '../protocol/types';

/**
 * Camera capture class
 */
export class CameraCapture {
  private stream: MediaStream | null = null;
  private videoElement: HTMLVideoElement | null = null;
  private canvas: OffscreenCanvas | null = null;
  private ctx: OffscreenCanvasRenderingContext2D | null = null;
  private isCapturing = false;
  private frameCallback: ((imageData: ImageData) => void) | null = null;
  private animationFrameId: number | null = null;

  /**
   * Initialize camera
   */
  async initialize(config: CameraConfig): Promise<void> {
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: config.width },
          height: { ideal: config.height },
          frameRate: { ideal: config.frameRate },
          facingMode: config.facingMode,
        },
      });

      this.videoElement = document.createElement('video');
      this.videoElement.srcObject = this.stream;
      this.videoElement.autoplay = true;
      this.videoElement.playsInline = true;

      await new Promise<void>((resolve) => {
        if (this.videoElement) {
          this.videoElement.onloadedmetadata = () => resolve();
        }
      });

      const width = this.videoElement.videoWidth;
      const height = this.videoElement.videoHeight;

      this.canvas = new OffscreenCanvas(width, height);
      this.ctx = this.canvas.getContext('2d');
    } catch (error) {
      throw new Error(`Failed to initialize camera: ${error}`);
    }
  }

  /**
   * Start capturing frames
   */
  startCapture(callback: (imageData: ImageData) => void): void {
    this.frameCallback = callback;
    this.isCapturing = true;
    this.captureFrame();
  }

  /**
   * Stop capturing frames
   */
  stopCapture(): void {
    this.isCapturing = false;
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  /**
   * Capture single frame
   */
  private captureFrame(): void {
    if (!this.isCapturing || !this.videoElement || !this.canvas || !this.ctx) {
      return;
    }

    try {
      // Draw video frame to canvas
      this.ctx.drawImage(this.videoElement, 0, 0, this.canvas.width, this.canvas.height);

      // Get image data
      const imageData = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);

      // Call callback
      if (this.frameCallback) {
        this.frameCallback(imageData);
      }
    } catch (error) {
      console.error('Frame capture error:', error);
    }

    // Schedule next frame
    this.animationFrameId = requestAnimationFrame(() => this.captureFrame());
  }

  /**
   * Release camera resources
   */
  release(): void {
    this.stopCapture();

    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }

    if (this.videoElement) {
      this.videoElement.srcObject = null;
      this.videoElement = null;
    }

    this.canvas = null;
    this.ctx = null;
    this.frameCallback = null;
  }

  /**
   * Get current video element for preview
   */
  getVideoElement(): HTMLVideoElement | null {
    return this.videoElement;
  }

  /**
   * Check if camera is active
   */
  isActive(): boolean {
    return this.stream !== null && this.stream.active;
  }

  /**
   * Get camera capabilities
   */
  async getCapabilities(): Promise<MediaTrackCapabilities | null> {
    if (!this.stream) return null;

    const videoTrack = this.stream.getVideoTracks()[0];
    return videoTrack.getCapabilities();
  }

  /**
   * Adjust camera settings
   */
  async adjustSettings(settings: MediaTrackConstraints): Promise<void> {
    if (!this.stream) return;

    const videoTrack = this.stream.getVideoTracks()[0];
    await videoTrack.applyConstraints(settings);
  }
}

/**
 * Request camera permission
 */
export async function requestCameraPermission(): Promise<boolean> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true });
    stream.getTracks().forEach(track => track.stop());
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Get available cameras
 */
export async function getAvailableCameras(): Promise<MediaDeviceInfo[]> {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter(device => device.kind === 'videoinput');
  } catch (error) {
    return [];
  }
}

/**
 * Check if camera is supported
 */
export function isCameraSupported(): boolean {
  return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
}
