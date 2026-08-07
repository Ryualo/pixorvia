# 📡 PixorGrid

**Transfer files between devices using only light — no internet, Wi-Fi, Bluetooth, or cables required.**

PixorGrid is an offline-first Progressive Web App (PWA) that enables visual file transfer between a desktop browser and a phone camera using high-density animated QR codes. It functions like a visual modem, encoding data into light patterns that are captured and decoded in real-time.

[![Deploy Status](https://github.com/YOUR_USERNAME/PixorGrid/actions/workflows/deploy.yml/badge.svg)](https://github.com/YOUR_USERNAME/PixorGrid/actions/workflows/deploy.yml)

🚀 **[Live Demo](https://YOUR_USERNAME.github.io/PixorGrid/)**

---

## ✨ Features

### 🔒 **100% Offline & Private**
- No internet connection required after first load
- No servers, no cloud, no data ever leaves your devices
- Complete air-gap file transfer using only visible light

### ⚡ **High-Speed Transfer**
- **2000 bytes per QR code** (4x denser than standard)
- Adjustable frame rate: 1-30 FPS
- Example: Transfer a 1MB file in ~23 seconds at 30 FPS

### 📱 **Cross-Platform**
- **Desktop**: Drag & drop files, animate QR codes
- **Phone**: Scan codes with camera, download directly
- Works on iOS, Android, Windows, Mac, Linux

### 🎨 **Polished UI**
- Futuristic scanning laser animation
- Real-time transfer progress
- Image/video preview before sending
- Dark mode design

### 💾 **File Support**
- Images (JPG, PNG, GIF, WebP)
- Videos (MP4, WebM, MOV)
- Documents (PDF, TXT, CSV)
- Archives (ZIP)
- Any file type supported

### 🔄 **Smart Transfer**
- Infinite loop carousel (never miss a frame)
- Automatic error detection and recovery
- Native device file download (Files app / Downloads folder)
- Proper MIME type detection

---

## �️ How It Works

### Desktop (Transmitter)
1. User selects a file
2. File is encoded to Base64
3. Data split into 2000-byte chunks
4. Each chunk encoded as a high-density QR code
5. QR codes animate at 1-30 FPS in an infinite loop

### Phone (Receiver)
1. Camera continuously scans the screen
2. Each QR code decoded on capture
3. Chunks stored and tracked
4. Missing chunks automatically recovered from the loop
5. Complete file reconstructed and downloaded

### Technical Stack
- **Frontend**: React 18 + TypeScript
- **Build Tool**: Vite 6
- **QR Generation**: `qrcode.react` (Level L, max density)
- **QR Scanning**: `html5-qrcode` (10 FPS camera)
- **PWA**: `vite-plugin-pwa` with Workbox
- **Deployment**: GitHub Actions → GitHub Pages

---

## 🚀 Quick Start

### Prerequisites
- Node.js 20+ and npm

### Installation

```bash
# Clone the repository
git clone https://github.com/YOUR_USERNAME/PixorGrid.git
cd PixorGrid

# Install dependencies
npm install

# Start development server
npm run dev
```

The app will be available at `http://localhost:5173/PixorGrid/`

### Build for Production

```bash
npm run build
```

The optimized build will be in the `dist/` folder.

---

## 📖 Usage Guide

### Desktop Mode (Send Files)

1. **Select File**
   - Drag and drop any file, or click to browse
   - Preview images/videos before sending
   - See file info (name, size, type)

2. **Prepare Transfer**
   - Click "🚀 Prepare File"
   - File is split into high-density chunks
   - See total chunk count

3. **Start Transmission**
   - Click "▶ Start Transmission"
   - QR codes animate in fullscreen
   - Adjust speed slider (1-30 FPS) for optimal scanning

4. **Tips**
   - Use 12-15 FPS for reliability
   - Increase brightness for better scanning
   - Keep monitor visible to phone camera

### Phone Mode (Receive Files)

1. **Enable Camera**
   - Click "📸 Enable Camera"
   - Grant camera permissions
   - Point at animated QR codes

2. **Scan & Receive**
   - Keep phone steady, aimed at monitor
   - Green laser line shows active scanning
   - Progress bar shows chunks received

3. **Download File**
   - Wait for "Transfer Complete!" message
   - Click "⬇ Download File"
   - File saves to Downloads or Files app

4. **Tips**
   - Keep distance ~30-60cm from screen
   - Ensure good lighting (avoid glare)
   - QR codes loop infinitely — you won't miss chunks

---

## 📊 Performance

| File Size | Chunks | Time @ 12 FPS | Time @ 20 FPS | Time @ 30 FPS |
|-----------|--------|---------------|---------------|---------------|
| 100 KB    | ~68    | ~5.7s         | ~3.4s         | ~2.3s         |
| 500 KB    | ~340   | ~28s          | ~17s          | ~11s          |
| 1 MB      | ~680   | ~57s          | ~34s          | ~23s          |
| 5 MB      | ~3400  | ~4.7min       | ~2.8min       | ~1.9min       |

*Actual speeds vary based on camera quality, lighting, and processing power.*

---

## 🌐 Deployment

### Deploy to GitHub Pages

1. **Update Repository Name**
   - Edit `vite.config.ts` and change `base: '/PixorGrid/'` to match your repo name

2. **Enable GitHub Pages**
   - Go to Settings → Pages
   - Source: GitHub Actions

3. **Push to Main**
   - Workflow automatically builds and deploys
   - App live at `https://YOUR_USERNAME.github.io/PixorGrid/`

### Custom Domain (Optional)
Add a `CNAME` file to `/public/` with your domain.

---

## � Configuration

### Adjust Transfer Speed
In `src/components/DesktopTransmitter.tsx`:
```typescript
const [targetFps, setTargetFps] = useState(12); // Change default FPS
```

### Adjust Chunk Size
In `src/components/DesktopTransmitter.tsx`:
```typescript
const QR_CHUNK_SIZE = 2000; // Increase/decrease (max ~3500)
```

### Customize PWA
Edit `vite.config.ts` manifest section for app name, colors, icons.

---

## 🤝 Contributing

Contributions welcome! Feel free to:
- Report bugs or suggest features via Issues
- Submit Pull Requests with improvements
- Share your use cases and feedback

---

## 📄 License

MIT License - feel free to use for personal or commercial projects.

---

## 🙏 Acknowledgments

- **QR Code Libraries**: qrcode.react, html5-qrcode
- **Inspired by**: Optical data transfer research, acoustic modems, and air-gapped security

---

## 🔮 Future Enhancements

- [ ] Reed-Solomon error correction
- [ ] Multi-file batch transfers
- [ ] Color QR codes (RGB encoding for 3x throughput)
- [ ] Resume interrupted transfers
- [ ] Transfer encryption
- [ ] Peer-to-peer phone-to-phone transfer

---

**Built with ❤️ for offline file sharing**

*Perfect for: Air-gapped systems, privacy-focused transfers, emergency communication, tech demos, and just having fun with physics!*
