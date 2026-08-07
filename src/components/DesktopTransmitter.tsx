/**
 * Simplified Desktop Transmitter - Animated QR Codes
 */

import { useState, useEffect, useRef } from 'react';
import { QRCodeSVG } from 'qrcode.react';

export function DesktopTransmitter() {
  const [file, setFile] = useState<File | null>(null);
  const [chunks, setChunks] = useState<string[]>([]);
  const [currentChunkIndex, setCurrentChunkIndex] = useState(0);
  const [isTransmitting, setIsTransmitting] = useState(false);
  const [isPreparing, setIsPreparing] = useState(false);
  const [fps, setFps] = useState(0);
  const [targetFps, setTargetFps] = useState(12); // Configurable target FPS (max 30)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const animationRef = useRef<number | null>(null);
  const lastFrameTimeRef = useRef<number>(Date.now());

  /**
   * Handle file selection and generate preview
   */
  const handleFileSelect = (selectedFile: File) => {
    // Clean up previous preview URL
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }

    setFile(selectedFile);
    setChunks([]);
    setCurrentChunkIndex(0);
    setIsTransmitting(false);

    // Generate preview for images and videos
    if (selectedFile.type.startsWith('image/') || selectedFile.type.startsWith('video/')) {
      const url = URL.createObjectURL(selectedFile);
      setPreviewUrl(url);
    } else {
      setPreviewUrl(null);
    }
  };

  /**
   * Cleanup preview URL on unmount
   */
  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  /**
   * Handle drag and drop
   */
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile) {
      handleFileSelect(droppedFile);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  /**
   * Convert file to base64 and split into chunks
   */
  const prepareFile = async () => {
    if (!file) return;

    setIsPreparing(true);

    try {
      // Read file as array buffer
      const arrayBuffer = await file.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);

      // Convert to base64 in chunks to avoid stack overflow
      let base64 = '';
      const ENCODE_CHUNK_SIZE = 8192; // Process 8KB at a time
      
      for (let i = 0; i < bytes.length; i += ENCODE_CHUNK_SIZE) {
        const chunk = bytes.slice(i, Math.min(i + ENCODE_CHUNK_SIZE, bytes.length));
        const chunkStr = String.fromCharCode(...Array.from(chunk));
        base64 += btoa(chunkStr);
      }

      // Split into QR code chunks (2000 bytes each for high-density QR codes)
      // Version 40 QR with Level L can hold ~4000 alphanumeric chars
      // We use 2000 bytes to leave room for headers and ensure reliability
      const QR_CHUNK_SIZE = 2000;
      const fileId = Date.now().toString(36);
      const totalChunks = Math.ceil(base64.length / QR_CHUNK_SIZE);
      const newChunks: string[] = [];

      console.log(`Preparing ${file.name} (${(file.size / 1024).toFixed(2)} KB) into ${totalChunks} HIGH-DENSITY chunks...`);

      for (let i = 0; i < totalChunks; i++) {
        const start = i * QR_CHUNK_SIZE;
        const end = Math.min(start + QR_CHUNK_SIZE, base64.length);
        const chunkData = base64.slice(start, end);

        // Format: [FileID]|[ChunkIndex]|[TotalChunks]|[FileName]|[Data]
        const chunkString = `${fileId}|${i}|${totalChunks}|${file.name}|${chunkData}`;
        newChunks.push(chunkString);
      }

      setChunks(newChunks);
      console.log(`✅ File prepared: ${totalChunks} chunks, ${(base64.length / 1024).toFixed(2)} KB encoded`);
    } catch (error) {
      console.error('Error preparing file:', error);
      alert(`Error preparing file: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsPreparing(false);
    }
  };

  /**
   * Start animated QR code transmission
   */
  const startTransmission = () => {
    setIsTransmitting(true);
    setCurrentChunkIndex(0);
  };

  const stopTransmission = () => {
    setIsTransmitting(false);
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
    }
  };

  /**
   * Animate through QR codes (infinite loop)
   */
  useEffect(() => {
    if (!isTransmitting || chunks.length === 0) return;

    const FRAME_DURATION = 1000 / targetFps;
    let lastTime = Date.now();

    const animate = () => {
      const now = Date.now();
      const elapsed = now - lastTime;

      if (elapsed >= FRAME_DURATION) {
        // Infinite loop: resets to 0 after last chunk
        setCurrentChunkIndex((prev) => (prev + 1) % chunks.length);
        
        // Calculate actual FPS
        const actualFps = 1000 / (now - lastFrameTimeRef.current);
        setFps(Math.round(actualFps * 10) / 10);
        lastFrameTimeRef.current = now;
        lastTime = now;
      }

      animationRef.current = requestAnimationFrame(animate);
    };

    animationRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [isTransmitting, chunks, targetFps]);

  /**
   * Calculate transfer stats
   */
  const progress = chunks.length > 0 ? ((currentChunkIndex + 1) / chunks.length) * 100 : 0;

  return (
    <div className="desktop-transmitter">
      <div className="header">
        <h1>📡 Desktop Transmitter</h1>
        <p>Transfer files using animated QR codes</p>
      </div>

      {!file && (
        <div
          className="drop-zone"
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onClick={() => document.getElementById('file-input')?.click()}
        >
          <div className="drop-zone-content">
            <div className="icon">📁</div>
            <h2>Drop a file here</h2>
            <p>or click to browse</p>
            <p className="hint">Works best with files under 5MB</p>
          </div>
          <input
            id="file-input"
            type="file"
            style={{ display: 'none' }}
            onChange={(e) => e.target.files?.[0] && handleFileSelect(e.target.files[0])}
          />
        </div>
      )}

      {file && !isTransmitting && (
        <div className="file-info">
          <h3>Selected File</h3>
          
          {/* File Preview for Images and Videos */}
          {previewUrl && (
            <div className="file-preview" style={{ margin: '20px 0', textAlign: 'center' }}>
              {file.type.startsWith('image/') && (
                <img 
                  src={previewUrl} 
                  alt="File preview" 
                  style={{ 
                    maxHeight: '200px', 
                    maxWidth: '100%',
                    borderRadius: '8px',
                    objectFit: 'contain'
                  }} 
                />
              )}
              {file.type.startsWith('video/') && (
                <video 
                  src={previewUrl} 
                  controls 
                  style={{ 
                    maxHeight: '200px', 
                    maxWidth: '100%',
                    borderRadius: '8px'
                  }} 
                />
              )}
            </div>
          )}

          <div className="file-details">
            <p><strong>Name:</strong> {file.name}</p>
            <p><strong>Size:</strong> {(file.size / 1024).toFixed(2)} KB</p>
            <p><strong>Type:</strong> {file.type || 'Unknown'}</p>
            {chunks.length > 0 && (
              <p><strong>Chunks:</strong> {chunks.length}</p>
            )}
          </div>

          <div className="controls">
            {chunks.length === 0 ? (
              <button
                className="btn-primary btn-large"
                onClick={prepareFile}
                disabled={isPreparing}
              >
                {isPreparing ? '⏳ Preparing...' : '🚀 Prepare File'}
              </button>
            ) : (
              <button
                className="btn-success btn-large"
                onClick={startTransmission}
              >
                ▶ Start Transmission
              </button>
            )}
            <button
              className="btn-secondary"
              onClick={() => {
                setFile(null);
                setChunks([]);
                setCurrentChunkIndex(0);
              }}
            >
              ✕ Cancel
            </button>
          </div>
        </div>
      )}

      {isTransmitting && chunks.length > 0 && (
        <>
          <div className="display-container">
            <QRCodeSVG
              value={chunks[currentChunkIndex]}
              size={600}
              level="L"
              includeMargin={true}
              className="qr-code"
            />
            <div className="chunk-indicator">
              High-Density Chunk {currentChunkIndex + 1} of {chunks.length}
            </div>
          </div>

          <div className="stats">
            <div className="stat-item">
              <label>Current Chunk</label>
              <span className="value">{currentChunkIndex + 1}/{chunks.length}</span>
            </div>
            <div className="stat-item">
              <label>Actual FPS</label>
              <span className="value">{fps}</span>
            </div>
            <div className="stat-item">
              <label>Target FPS</label>
              <span className="value">{targetFps}</span>
            </div>
            <div className="stat-item">
              <label>Loop Progress</label>
              <span className="value">{progress.toFixed(1)}%</span>
            </div>
          </div>

          <div className="speed-control" style={{ 
            background: 'rgba(255, 255, 255, 0.05)', 
            padding: '20px', 
            borderRadius: '12px',
            margin: '20px 0',
            border: '1px solid rgba(255, 255, 255, 0.1)'
          }}>
            <label htmlFor="fps-slider">
              <strong>⚡ Speed Control:</strong> <span style={{ color: '#00d4ff' }}>{targetFps} FPS</span> ({Math.round(1000 / targetFps)}ms per frame)
            </label>
            <input
              id="fps-slider"
              type="range"
              min="1"
              max="30"
              value={targetFps}
              onChange={(e) => setTargetFps(Number(e.target.value))}
              style={{ 
                width: '100%', 
                margin: '10px 0',
                height: '6px',
                cursor: 'pointer'
              }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem', color: '#aaa' }}>
              <span>1 FPS (slow)</span>
              <span>12 FPS (balanced)</span>
              <span>30 FPS (max)</span>
            </div>
          </div>

          <div className="controls">
            <button className="btn-warning" onClick={stopTransmission}>
              ⏸ Stop
            </button>
          </div>
        </>
      )}

      <div className="instructions">
        <h3>How to Use</h3>
        <ol>
          <li>Drop or select a file to transfer</li>
          <li>Click "Prepare File" to split into QR chunks</li>
          <li>Click "Start Transmission" to animate QR codes</li>
          <li>On your phone, open this site and scan the QR codes</li>
        </ol>
      </div>
    </div>
  );
}
