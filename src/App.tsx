/**
 * PixorGrid Main App
 * Visual file transfer using light
 */

import { useState, useEffect } from 'react';
import { DesktopTransmitter } from './components/DesktopTransmitter';
import { PhoneReceiver } from './components/PhoneReceiver';
import './App.css';

type DeviceMode = 'auto' | 'desktop' | 'phone';

function App() {
  const [mode, setMode] = useState<DeviceMode>('auto');
  const [detectedMode, setDetectedMode] = useState<'desktop' | 'phone'>('desktop');

  /**
   * Detect device type
   */
  useEffect(() => {
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
      navigator.userAgent
    );
    const hasTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    const isSmallScreen = window.innerWidth < 768;

    if (isMobile || (hasTouch && isSmallScreen)) {
      setDetectedMode('phone');
    } else {
      setDetectedMode('desktop');
    }
  }, []);

  const activeMode = mode === 'auto' ? detectedMode : mode;

  return (
    <div className="app">
      <div className="mode-selector">
        <button
          className={mode === 'auto' ? 'active' : ''}
          onClick={() => setMode('auto')}
        >
          Auto
        </button>
        <button
          className={mode === 'desktop' ? 'active' : ''}
          onClick={() => setMode('desktop')}
        >
          Desktop
        </button>
        <button
          className={mode === 'phone' ? 'active' : ''}
          onClick={() => setMode('phone')}
        >
          Phone
        </button>
      </div>

      {activeMode === 'desktop' ? <DesktopTransmitter /> : <PhoneReceiver />}

      <footer>
        <p>PixorGrid - Transfer files using light • No internet, network, or Bluetooth required</p>
      </footer>
    </div>
  );
}

export default App;
