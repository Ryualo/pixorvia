/**
 * Simplified Phone Receiver - QR Code Scanner
 */

import { useState, useEffect, useRef } from 'react';
import { Html5Qrcode } from 'html5-qrcode';

interface ReceivedChunk {
  fileId: string;
  chunkIndex: number;
  totalChunks: number;
  fileName: string;
  data: string;
}

export function PhoneReceiver() {
  const [isScanning, setIsScanning] = useState(false);
  const [receivedChunks, setReceivedChunks] = useState<Map<number, ReceivedChunk>>(new Map());
  const [fileInfo, setFileInfo] = useState<{ fileName: string; totalChunks: number } | null>(null);
  const [isComplete, setIsComplete] = useState(false);
  const [scanCount, setScanCount] = useState(0);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const scannerDivRef = useRef<HTMLDivElement>(null);

  /**
   * Parse QR code data
   * Format: [FileID]|[ChunkIndex]|[TotalChunks]|[FileName]|[Data]
   */
  const parseChunk = (qrData: string): ReceivedChunk | null => {
    try {
      const parts = qrData.split('|');
      if (parts.length < 5) return null;

      return {
        fileId: parts[0],
        chunkIndex: parseInt(parts[1]),
        totalChunks: parseInt(parts[2]),
        fileName: parts[3],
        data: parts.slice(4).join('|'), // Rejoin in case data contains |
      };
    } catch (error) {
      console.error('Error parsing chunk:', error);
      return null;
    }
  };

  /**
   * Handle successful QR scan
   */
  const handleScanSuccess = (decodedText: string) => {
    const chunk = parseChunk(decodedText);
    if (!chunk) return;

    // Set file info on first chunk
    if (!fileInfo) {
      setFileInfo({
        fileName: chunk.fileName,
        totalChunks: chunk.totalChunks,
      });
    }

    // Add chunk if not already received
    setReceivedChunks((prev) => {
      if (prev.has(chunk.chunkIndex)) return prev;
      const newMap = new Map(prev);
      newMap.set(chunk.chunkIndex, chunk);
      console.log(`Received chunk ${chunk.chunkIndex + 1}/${chunk.totalChunks}`);
      return newMap;
    });

    setScanCount((prev) => prev + 1);
  };

  /**
   * Start QR code scanning
   */
  const startScanning = async () => {
    try {
      const scanner = new Html5Qrcode('qr-reader');
      scannerRef.current = scanner;

      await scanner.start(
        { facingMode: 'environment' },
        {
          fps: 10,
          qrbox: { width: 300, height: 300 },
        },
        handleScanSuccess,
        () => {
          // Error callback - ignore, just means no QR detected
        }
      );

      setIsScanning(true);
    } catch (error) {
      console.error('Error starting scanner:', error);
      alert('Failed to start camera. Please grant camera permissions.');
    }
  };

  /**
   * Stop scanning
   */
  const stopScanning = async () => {
    if (scannerRef.current) {
      try {
        await scannerRef.current.stop();
        scannerRef.current = null;
      } catch (error) {
        console.error('Error stopping scanner:', error);
      }
    }
    setIsScanning(false);
  };

  /**
   * Check if transfer is complete
   */
  useEffect(() => {
    if (!fileInfo) return;

    const hasAllChunks = receivedChunks.size === fileInfo.totalChunks;
    if (hasAllChunks && !isComplete) {
      setIsComplete(true);
      stopScanning();
      console.log('Transfer complete!');
    }
  }, [receivedChunks, fileInfo, isComplete]);

  /**
   * Detect MIME type from file extension
   */
  const getMimeType = (fileName: string): string => {
    const ext = fileName.split('.').pop()?.toLowerCase() || '';
    const mimeTypes: Record<string, string> = {
      // Images
      'jpg': 'image/jpeg',
      'jpeg': 'image/jpeg',
      'png': 'image/png',
      'gif': 'image/gif',
      'webp': 'image/webp',
      'bmp': 'image/bmp',
      'svg': 'image/svg+xml',
      // Videos
      'mp4': 'video/mp4',
      'webm': 'video/webm',
      'mov': 'video/quicktime',
      'avi': 'video/x-msvideo',
      // Audio
      'mp3': 'audio/mpeg',
      'wav': 'audio/wav',
      'ogg': 'audio/ogg',
      // Documents
      'pdf': 'application/pdf',
      'txt': 'text/plain',
      'json': 'application/json',
      'zip': 'application/zip',
      'csv': 'text/csv',
    };
    return mimeTypes[ext] || 'application/octet-stream';
  };

  /**
   * Reconstruct and download file to native device storage
   */
  const downloadFile = () => {
    if (!fileInfo || receivedChunks.size === 0) return;

    try {
      // Sort chunks by index and concatenate data
      const sortedChunks = Array.from(receivedChunks.values()).sort(
        (a, b) => a.chunkIndex - b.chunkIndex
      );

      const base64Data = sortedChunks.map((chunk) => chunk.data).join('');

      // Convert base64 back to bytes
      const binaryString = atob(base64Data);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      // Detect MIME type from file extension
      const mimeType = getMimeType(fileInfo.fileName);
      
      // Create blob with proper MIME type
      const blob = new Blob([bytes], { type: mimeType });
      
      // Create temporary object URL
      const url = URL.createObjectURL(blob);
      
      // Create hidden anchor element
      const a = document.createElement('a');
      a.href = url;
      a.download = fileInfo.fileName; // Original filename
      a.style.display = 'none';
      
      // Trigger native OS download
      document.body.appendChild(a);
      a.click();
      
      // Cleanup
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      console.log(`✅ File downloaded: ${fileInfo.fileName} (${mimeType})`);
    } catch (error) {
      console.error('Error downloading file:', error);
      alert('Error reconstructing file. Some chunks may be corrupted.');
    }
  };

  /**
   * Reset receiver
   */
  const reset = () => {
    stopScanning();
    setReceivedChunks(new Map());
    setFileInfo(null);
    setIsComplete(false);
    setScanCount(0);
  };

  /**
   * Calculate progress
   */
  const progress = fileInfo ? (receivedChunks.size / fileInfo.totalChunks) * 100 : 0;
  const signalQuality = scanCount > 0 ? Math.min((receivedChunks.size / scanCount) * 100, 100) : 0;

  return (
    <div className="phone-receiver">
      <div className="header">
        <h1>📱 Phone Receiver</h1>
        <p>Scan animated QR codes to receive files</p>
      </div>

      {!isScanning && !isComplete && (
        <div className="camera-setup">
          <div className="setup-content">
            <div className="icon">📷</div>
            <h2>Ready to Receive</h2>
            <p>Point your camera at the screen displaying QR codes</p>
            <button className="btn-primary btn-large" onClick={startScanning}>
              📸 Enable Camera
            </button>
          </div>
        </div>
      )}

      {isScanning && (
        <>
          <div className="video-container">
            <div id="qr-reader" ref={scannerDivRef}></div>
            {/* Scanning Laser Effect */}
            <div className="scanner-overlay">
              <div className="scan-line"></div>
            </div>
          </div>

          {fileInfo && (
            <div className="transfer-info">
              <h3>Receiving: {fileInfo.fileName}</h3>
              
              <div className="progress-bar">
                <div className="progress-fill" style={{ width: `${progress}%` }}></div>
              </div>

              <div className="transfer-stats">
                <div className="stat-row">
                  <span>Progress:</span>
                  <span>{progress.toFixed(1)}%</span>
                </div>
                <div className="stat-row">
                  <span>Chunks:</span>
                  <span>{receivedChunks.size} / {fileInfo.totalChunks}</span>
                </div>
                <div className="stat-row">
                  <span>Scans:</span>
                  <span>{scanCount}</span>
                </div>
                <div className="stat-row">
                  <span>Signal Quality:</span>
                  <span>{signalQuality.toFixed(0)}%</span>
                </div>
              </div>
            </div>
          )}

          <div className="controls">
            <button className="btn-secondary" onClick={stopScanning}>
              ⏸ Stop Scanning
            </button>
          </div>
        </>
      )}

      {isComplete && fileInfo && (
        <div className="download-ready">
          <div className="success-icon">✅</div>
          <h2>Transfer Complete!</h2>
          <p>Received all {fileInfo.totalChunks} chunks</p>
          <p className="filename">{fileInfo.fileName}</p>
          
          <div className="controls">
            <button className="btn-success btn-large" onClick={downloadFile}>
              ⬇ Download File
            </button>
            <button className="btn-secondary" onClick={reset}>
              🔄 Receive Another
            </button>
          </div>
        </div>
      )}

      {!isScanning && !isComplete && (
        <div className="instructions">
          <h3>How It Works</h3>
          <ol>
            <li>Click "Enable Camera" to start scanning</li>
            <li>Point your camera at the animated QR codes on the screen</li>
            <li>Keep the QR code centered in the frame</li>
            <li>Wait until all chunks are received</li>
            <li>Download the reconstructed file</li>
          </ol>
          <p className="hint">💡 Tip: Keep camera steady and ensure good lighting</p>
        </div>
      )}
    </div>
  );
}
