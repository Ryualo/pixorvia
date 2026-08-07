/**
 * useTransfer Hook - Manage file transfer state
 */

import { useState, useCallback, useRef } from 'react';
import type { Packet, FileMetadata, TransferStats, EncoderConfig } from '../protocol/types';
import { TransferStatus, WorkerMessageType } from '../protocol/types';
import { DEFAULT_PACKET_SIZE, TARGET_FPS, REED_SOLOMON_REDUNDANCY } from '../protocol/types';

export function useTransfer() {
  const [status, setStatus] = useState<TransferStatus>(TransferStatus.IDLE);
  const [packets, setPackets] = useState<Packet[]>([]);
  const [metadata, setMetadata] = useState<FileMetadata | null>(null);
  const [stats, setStats] = useState<TransferStats>({
    fps: 0,
    packetsSent: 0,
    packetsReceived: 0,
    totalPackets: 0,
    bytesTransferred: 0,
    totalBytes: 0,
    progress: 0,
    elapsedTime: 0,
    estimatedTimeRemaining: 0,
    errorRate: 0,
    signalQuality: 0,
  });
  const [error, setError] = useState<string | null>(null);
  
  const workerRef = useRef<Worker | null>(null);
  const startTimeRef = useRef<number>(0);

  /**
   * Initialize encoder worker
   */
  const initializeEncoder = useCallback(() => {
    if (workerRef.current) {
      workerRef.current.terminate();
    }

    workerRef.current = new Worker(
      new URL('../workers/encoder.worker.ts', import.meta.url),
      { type: 'module' }
    );

    workerRef.current.onmessage = (e: MessageEvent) => {
      const { type, data, error: workerError } = e.data;

      switch (type) {
        case WorkerMessageType.PROGRESS:
          handleEncoderProgress(data);
          break;
        case WorkerMessageType.RESULT:
          handleEncoderResult(data);
          break;
        case WorkerMessageType.ERROR:
          setError(workerError);
          setStatus(TransferStatus.ERROR);
          break;
      }
    };
  }, []);

  /**
   * Initialize decoder worker
   */
  const initializeDecoder = useCallback(() => {
    if (workerRef.current) {
      workerRef.current.terminate();
    }

    workerRef.current = new Worker(
      new URL('../workers/decoder.worker.ts', import.meta.url),
      { type: 'module' }
    );

    workerRef.current.onmessage = (e: MessageEvent) => {
      const { type, data, error: workerError } = e.data;

      switch (type) {
        case WorkerMessageType.PROGRESS:
          handleDecoderProgress(data);
          break;
        case WorkerMessageType.RESULT:
          handleDecoderResult(data);
          break;
        case WorkerMessageType.ERROR:
          console.error('Decoder error:', workerError);
          break;
      }
    };
  }, []);

  /**
   * Handle encoder progress updates
   */
  const handleEncoderProgress = useCallback((data: any) => {
    if (data.stage === 'metadata') {
      setMetadata(data.metadata);
    } else if (data.stage === 'packetized') {
      setStats(prev => ({
        ...prev,
        totalPackets: data.totalPackets,
        totalBytes: metadata?.size || 0,
      }));
    }
  }, [metadata]);

  /**
   * Handle encoder result
   */
  const handleEncoderResult = useCallback((data: any) => {
    setPackets(data.packets);
    setMetadata(data.metadata);
    setStatus(TransferStatus.IDLE);
  }, []);

  /**
   * Handle decoder progress updates
   */
  const handleDecoderProgress = useCallback((data: any) => {
    if (data.signalQuality !== undefined) {
      setStats(prev => ({
        ...prev,
        signalQuality: data.signalQuality,
      }));
    }
  }, []);

  /**
   * Handle decoder result
   */
  const handleDecoderResult = useCallback((data: any) => {
    if (data.packet) {
      // Add received packet
      setPackets(prev => [...prev, data.packet]);
      setStats(prev => ({
        ...prev,
        packetsReceived: prev.packetsReceived + 1,
        progress: ((prev.packetsReceived + 1) / prev.totalPackets) * 100,
      }));
    } else if (data.fileData) {
      // File reassembly complete
      setStatus(TransferStatus.COMPLETED);
    }
  }, []);

  /**
   * Encode file for transmission
   */
  const encodeFile = useCallback(async (file: File) => {
    setStatus(TransferStatus.PREPARING);
    setError(null);
    startTimeRef.current = Date.now();

    initializeEncoder();

    const config: EncoderConfig = {
      packetSize: DEFAULT_PACKET_SIZE,
      fps: TARGET_FPS,
      redundancy: REED_SOLOMON_REDUNDANCY,
      compressionLevel: 6,
    };

    const fileData = await file.arrayBuffer();

    workerRef.current?.postMessage({
      type: WorkerMessageType.ENCODE,
      data: {
        fileData,
        fileName: file.name,
        fileType: file.type,
        lastModified: file.lastModified,
        config,
      },
    });
  }, [initializeEncoder]);

  /**
   * Start receiving transfer
   */
  const startReceiving = useCallback((expectedMetadata: FileMetadata) => {
    setStatus(TransferStatus.TRANSFERRING);
    setMetadata(expectedMetadata);
    setPackets([]);
    setStats(prev => ({
      ...prev,
      totalPackets: 0,
      packetsReceived: 0,
      progress: 0,
    }));
    startTimeRef.current = Date.now();

    initializeDecoder();
  }, [initializeDecoder]);

  /**
   * Process received frame
   */
  const processFrame = useCallback((imageData: ImageData) => {
    if (status !== TransferStatus.TRANSFERRING) return;

    workerRef.current?.postMessage({
      type: WorkerMessageType.DECODE,
      data: { imageData },
    });
  }, [status]);

  /**
   * Finalize transfer
   */
  const finalizeTransfer = useCallback(() => {
    if (packets.length === 0) return null;

    workerRef.current?.postMessage({
      type: 'reassemble',
      data: { packets },
    });

    return null;
  }, [packets]);

  /**
   * Reset transfer state
   */
  const reset = useCallback(() => {
    setStatus(TransferStatus.IDLE);
    setPackets([]);
    setMetadata(null);
    setError(null);
    setStats({
      fps: 0,
      packetsSent: 0,
      packetsReceived: 0,
      totalPackets: 0,
      bytesTransferred: 0,
      totalBytes: 0,
      progress: 0,
      elapsedTime: 0,
      estimatedTimeRemaining: 0,
      errorRate: 0,
      signalQuality: 0,
    });

    if (workerRef.current) {
      workerRef.current.terminate();
      workerRef.current = null;
    }
  }, []);

  /**
   * Update transfer statistics
   */
  const updateStats = useCallback((updates: Partial<TransferStats>) => {
    setStats(prev => ({ ...prev, ...updates }));
  }, []);

  return {
    status,
    packets,
    metadata,
    stats,
    error,
    encodeFile,
    startReceiving,
    processFrame,
    finalizeTransfer,
    reset,
    updateStats,
    setStatus,
  };
}
