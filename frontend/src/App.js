import { useState, useRef, useEffect, useCallback } from 'react';
import QRCode from 'qrcode';

const API = 'https://japanese-tracker-production.up.railway.app/api';

// Compress image before sending to backend
const compressImage = (file, maxWidth = 800, quality = 0.6) => {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;
        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        }
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
};

// ── IMAGE VIEWER COMPONENT ──────────────────────────────────────────────────
function ImageViewer({ images, startIndex, onClose }) {
  const [current, setCurrent] = useState(startIndex || 0);
  const touchStartX = useRef(null);

  const prev = () => setCurrent(i => Math.max(0, i - 1));
  const next = () => setCurrent(i => Math.min(images.length - 1, i + 1));

  const onTouchStart = (e) => { touchStartX.current = e.touches[0].clientX; };
  const onTouchEnd = (e) => {
    if (touchStartX.current === null) return;
    const diff = touchStartX.current - e.changedTouches[0].clientX;
    if (Math.abs(diff) > 50) { diff > 0 ? next() : prev(); }
    touchStartX.current = null;
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, background: '#000', zIndex: 9999,
      display: 'flex', flexDirection: 'column'
    }}>
      {/* Top bar */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '12px 20px', background: 'rgba(0,0,0,0.8)'
      }}>
        <button onClick={onClose} style={{
          background: 'none', border: 'none', color: '#fff', fontSize: 28, cursor: 'pointer', lineHeight: 1
        }}>✕</button>
        <span style={{ color: '#fff', fontSize: 15, fontWeight: 600 }}>
          Page {current + 1} / {images.length}
        </span>
        <div style={{ width: 32 }} />
      </div>

      {/* Image */}
      <div
        style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        <img
          src={images[current]}
          alt={`Page ${current + 1}`}
          style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
        />
      </div>

      {/* Bottom nav */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '16px 24px', background: 'rgba(0,0,0,0.8)'
      }}>
        <button onClick={prev} disabled={current === 0} style={{
          background: current === 0 ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.25)',
          color: '#fff', border: 'none', borderRadius: 10,
          padding: '10px 24px', fontSize: 18, cursor: current === 0 ? 'default' : 'pointer'
        }}>‹</button>

        {/* Dot indicators */}
        <div style={{ display: 'flex', gap: 6 }}>
          {images.map((_, i) => (
            <div key={i} onClick={() => setCurrent(i)} style={{
              width: i === current ? 20 : 8, height: 8,
              borderRadius: 4, background: i === current ? '#fff' : 'rgba(255,255,255,0.4)',
              cursor: 'pointer', transition: 'all 0.2s'
            }} />
          ))}
        </div>

        <button onClick={next} disabled={current === images.length - 1} style={{
          background: current === images.length - 1 ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.25)',
          color: '#fff', border: 'none', borderRadius: 10,
          padding: '10px 24px', fontSize: 18, cursor: current === images.length - 1 ? 'default' : 'pointer'
        }}>›</button>
      </div>
    </div>
  );
}

// ── CROP SCREEN COMPONENT ───────────────────────────────────────────────────
function CropScreen({ dataUrl, imgW, imgH, corners, setCorners, onConfirm, onRetake }) {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const draggingRef = useRef(null);
  const loadedImgRef = useRef(null);
  const cornersRef = useRef(corners);

  // Keep cornersRef in sync so canvas event handlers always see latest corners
  useEffect(() => { cornersRef.current = corners; }, [corners]);

  // Draw everything onto the canvas
  const draw = useCallback((img, crns) => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const cW = container.offsetWidth;
    const cH = container.offsetHeight;
    if (!cW || !cH) return;

    canvas.width = cW;
    canvas.height = cH;
    const ctx = canvas.getContext('2d');

    // Fit image inside canvas (letterbox)
    const scale = Math.min(cW / imgW, cH / imgH);
    const drawW = imgW * scale;
    const drawH = imgH * scale;
    const ox = (cW - drawW) / 2;
    const oy = (cH - drawH) / 2;

    // Draw full image
    ctx.clearRect(0, 0, cW, cH);
    ctx.drawImage(img, ox, oy, drawW, drawH);

    if (!crns || crns.length < 4) return;

    // Convert image coords → canvas pixels
    const toPx = c => ({ x: ox + (c.x / imgW) * drawW, y: oy + (c.y / imgH) * drawH });
    const pts = crns.map(toPx);

    // Darken outside crop area
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, 0, cW, cH);
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.closePath();
    ctx.clip();
    ctx.clearRect(0, 0, cW, cH);
    ctx.drawImage(img, ox, oy, drawW, drawH);
    ctx.restore();

    // Green border
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.closePath();
    ctx.strokeStyle = '#00FF88';
    ctx.lineWidth = 2.5;
    ctx.stroke();

    // Corner handles
    const labels = ['↖','↗','↘','↙'];
    pts.forEach((p, i) => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 22, 0, Math.PI * 2);
      ctx.fillStyle = '#00FF88';
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.fillStyle = '#000';
      ctx.font = 'bold 14px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(labels[i], p.x, p.y);
    });
  }, [imgW, imgH]);

  // Load image then draw — runs once on mount
  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      loadedImgRef.current = img;
      // Small timeout ensures the canvas element has rendered and has real dimensions
      setTimeout(() => {
        draw(img, cornersRef.current);
      }, 50);
    };
    img.src = dataUrl;
  }, []); // eslint-disable-line

  // Redraw whenever corners change (dragging)
  useEffect(() => {
    if (loadedImgRef.current) {
      draw(loadedImgRef.current, corners);
    }
  }, [corners, draw]);

  // Handle window resize
  useEffect(() => {
    const onResize = () => {
      if (loadedImgRef.current) draw(loadedImgRef.current, cornersRef.current);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [draw]);

  // Get touch/mouse position relative to canvas, scaled to canvas pixel space
  const getCanvasPos = (e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const src = e.touches ? e.touches[0] : e;
    return {
      x: (src.clientX - rect.left) * (canvas.width / rect.width),
      y: (src.clientY - rect.top) * (canvas.height / rect.height),
    };
  };

  // Convert canvas pixel → image coordinate
  const toImgCoord = (cx, cy) => {
    const canvas = canvasRef.current;
    const cW = canvas.width, cH = canvas.height;
    const scale = Math.min(cW / imgW, cH / imgH);
    const drawW = imgW * scale, drawH = imgH * scale;
    const ox = (cW - drawW) / 2, oy = (cH - drawH) / 2;
    return {
      x: Math.max(0, Math.min(imgW, ((cx - ox) / drawW) * imgW)),
      y: Math.max(0, Math.min(imgH, ((cy - oy) / drawH) * imgH)),
    };
  };

  // Find nearest corner handle within 50px
  const hitCorner = (cx, cy) => {
    const canvas = canvasRef.current;
    const cW = canvas.width, cH = canvas.height;
    const scale = Math.min(cW / imgW, cH / imgH);
    const drawW = imgW * scale, drawH = imgH * scale;
    const ox = (cW - drawW) / 2, oy = (cH - drawH) / 2;
    const crns = cornersRef.current;
    if (!crns) return -1;
    for (let i = 0; i < crns.length; i++) {
      const px = ox + (crns[i].x / imgW) * drawW;
      const py = oy + (crns[i].y / imgH) * drawH;
      if (Math.hypot(cx - px, cy - py) < 50) return i;
    }
    return -1;
  };

  const onPointerDown = (e) => {
    e.preventDefault();
    const { x, y } = getCanvasPos(e);
    draggingRef.current = hitCorner(x, y);
  };

  const onPointerMove = (e) => {
    if (draggingRef.current == null || draggingRef.current < 0) return;
    e.preventDefault();
    const { x, y } = getCanvasPos(e);
    const coord = toImgCoord(x, y);
    setCorners(prev => prev.map((c, i) => i === draggingRef.current ? coord : c));
  };

  const onPointerUp = () => { draggingRef.current = null; };

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#111', zIndex: 9999, display: 'flex', flexDirection: 'column' }}>
      {/* Top bar */}
      <div style={{ background: '#000', padding: '12px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0, zIndex: 10, position: 'relative' }}>
        <button onClick={onRetake} style={{ background: 'rgba(255,255,255,0.1)', border: 'none', color: '#fff', fontSize: 15, cursor: 'pointer', padding: '10px 16px', borderRadius: 8 }}>
          ← Retake
        </button>
        <span style={{ color: '#fff', fontSize: 15, fontWeight: 600 }}>Adjust Crop</span>
        <button onClick={onConfirm} style={{ background: '#007AFF', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 18px', fontSize: 15, fontWeight: 700, cursor: 'pointer' }}>
          Use ✓
        </button>
      </div>
      <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12, textAlign: 'center', padding: '6px 0', flexShrink: 0 }}>
        Drag the green corners to adjust
      </div>
      {/* Wrapper gives the canvas measurable dimensions */}
      <div ref={containerRef} style={{ flex: 1, position: 'relative', overflow: 'hidden', background: '#000' }}>
        <canvas
          ref={canvasRef}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', touchAction: 'none' }}
          onMouseDown={onPointerDown}
          onMouseMove={onPointerMove}
          onMouseUp={onPointerUp}
          onMouseLeave={onPointerUp}
          onTouchStart={onPointerDown}
          onTouchMove={onPointerMove}
          onTouchEnd={onPointerUp}
        />
      </div>
    </div>
  );
}

// ── DOCUMENT SCANNER COMPONENT (CamScanner-style) ──────────────────────────
function DocumentScanner({ onCapture, onClose }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const overlayCanvasRef = useRef(null);
  const streamRef = useRef(null);
  const animFrameRef = useRef(null);
  const stableCountRef = useRef(0);
  const lastCornersRef = useRef(null);

  // phase: 'camera' | 'crop'
  const [phase, setPhase] = useState('camera');
  const [capturedDataUrl, setCapturedDataUrl] = useState(null);
  const [imgSize, setImgSize] = useState({ w: 1, h: 1 });

  // 4 draggable corners [TL, TR, BR, BL]
  const [corners, setCorners] = useState(null);

  const [status, setStatus] = useState('Initializing camera...');
  const [detected, setDetected] = useState(false);
  const capturingRef = useRef(false);

  // ── CAMERA PHASE ─────────────────────────────────────────────────
  useEffect(() => {
    if (phase !== 'camera') return;
    const startCamera = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }
        });
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
          setStatus('Point camera at document');
          animFrameRef.current = requestAnimationFrame(detectLoop);
        }
      } catch { setStatus('Camera access denied.'); }
    };
    startCamera();
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
    };
  }, [phase]); // eslint-disable-line

  // ── EDGE HINT LOOP (dotted guide only, no auto-capture) ───────────
  const detectLoop = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const overlay = overlayCanvasRef.current;
    if (!video || !canvas || !overlay || video.readyState < 2) {
      animFrameRef.current = requestAnimationFrame(detectLoop);
      return;
    }
    const W = video.videoWidth;
    const H = video.videoHeight;
    const SW = Math.floor(W / 2), SH = Math.floor(H / 2);
    canvas.width = SW; canvas.height = SH;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, SW, SH);
    const imageData = ctx.getImageData(0, 0, SW, SH);

    overlay.width = overlay.offsetWidth;
    overlay.height = overlay.offsetHeight;
    const oCtx = overlay.getContext('2d');
    oCtx.clearRect(0, 0, overlay.width, overlay.height);

    const raw = findEdgeHint(imageData, SW, SH);
    if (raw) {
      const scaled = raw.map(p => ({ x: p.x * 2, y: p.y * 2 }));
      const sx = overlay.width / W, sy = overlay.height / H;
      const pts = scaled.map(p => ({ x: p.x * sx, y: p.y * sy }));
      oCtx.beginPath();
      oCtx.moveTo(pts[0].x, pts[0].y);
      pts.forEach(p => oCtx.lineTo(p.x, p.y));
      oCtx.closePath();
      oCtx.strokeStyle = '#00FF88';
      oCtx.lineWidth = 3;
      oCtx.setLineDash([10, 6]);
      oCtx.stroke();
      oCtx.setLineDash([]);
      oCtx.fillStyle = 'rgba(0,255,136,0.08)';
      oCtx.fill();
      pts.forEach(p => {
        oCtx.beginPath();
        oCtx.arc(p.x, p.y, 9, 0, Math.PI * 2);
        oCtx.fillStyle = '#00FF88';
        oCtx.fill();
      });
      lastCornersRef.current = scaled;
      setDetected(true);
      setStatus('Document in frame — tap 📸 to capture');
    } else {
      lastCornersRef.current = null;
      setDetected(false);
      setStatus('Point camera at document');
    }
    animFrameRef.current = requestAnimationFrame(detectLoop);
  };

  const findEdgeHint = (imageData, W, H) => {
    const data = imageData.data;
    const STEP = 4;
    const edges = new Uint8Array(W * H);
    for (let y = STEP; y < H - STEP; y += STEP) {
      for (let x = STEP; x < W - STEP; x += STEP) {
        const i = (y * W + x) * 4;
        const ir = (y * W + x + STEP) * 4;
        const id = ((y + STEP) * W + x) * 4;
        const b = (data[i] + data[i+1] + data[i+2]) / 3;
        const br = (data[ir] + data[ir+1] + data[ir+2]) / 3;
        const bd = (data[id] + data[id+1] + data[id+2]) / 3;
        if (Math.abs(b - br) + Math.abs(b - bd) > 35) edges[y * W + x] = 1;
      }
    }
    const M = Math.floor(W * 0.04);
    let top = -1, bottom = -1, left = -1, right = -1;
    for (let y = M; y < H / 2 && top === -1; y++) {
      let c = 0; for (let x = M; x < W - M; x++) if (edges[y * W + x]) c++;
      if (c > W * 0.2) top = y;
    }
    for (let y = H - M; y > H / 2 && bottom === -1; y--) {
      let c = 0; for (let x = M; x < W - M; x++) if (edges[y * W + x]) c++;
      if (c > W * 0.2) bottom = y;
    }
    for (let x = M; x < W / 2 && left === -1; x++) {
      let c = 0; for (let y = M; y < H - M; y++) if (edges[y * W + x]) c++;
      if (c > H * 0.15) left = x;
    }
    for (let x = W - M; x > W / 2 && right === -1; x--) {
      let c = 0; for (let y = M; y < H - M; y++) if (edges[y * W + x]) c++;
      if (c > H * 0.15) right = x;
    }
    if (top === -1 || bottom === -1 || left === -1 || right === -1) return null;
    if ((right - left) < W * 0.25 || (bottom - top) < H * 0.25) return null;
    return [{ x: left, y: top }, { x: right, y: top }, { x: right, y: bottom }, { x: left, y: bottom }];
  };

  // ── TAKE PHOTO → go to crop phase ────────────────────────────────
  const takePhoto = () => {
    if (capturingRef.current) return;
    capturingRef.current = true;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());

    const W = video.videoWidth, H = video.videoHeight;
    canvas.width = W; canvas.height = H;
    canvas.getContext('2d').drawImage(video, 0, 0, W, H);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.95);
    setCapturedDataUrl(dataUrl);

    // Init corners from detection or default
    const detected = lastCornersRef.current;
    const initCorners = detected ? [
      { ...detected[0] }, { ...detected[1] }, { ...detected[2] }, { ...detected[3] }
    ] : [
      { x: W * 0.08, y: H * 0.08 },
      { x: W * 0.92, y: H * 0.08 },
      { x: W * 0.92, y: H * 0.92 },
      { x: W * 0.08, y: H * 0.92 }
    ];
    setImgSize({ w: W, h: H });
    setCorners(initCorners);
    setPhase('crop');
  };



  const confirmCrop = () => {
    if (!corners || !capturedDataUrl) return;
    const img = new Image();
    img.onload = () => {
      const [tl, tr, br, bl] = corners;
      const x = Math.max(0, Math.min(tl.x, bl.x) - 6);
      const y = Math.max(0, Math.min(tl.y, tr.y) - 6);
      const w = Math.min(imgSize.w - x, Math.max(tr.x, br.x) - x + 6);
      const h = Math.min(imgSize.h - y, Math.max(bl.y, br.y) - y + 6);
      const dst = document.createElement('canvas');
      dst.width = Math.round(w); dst.height = Math.round(h);
      dst.getContext('2d').drawImage(img, x, y, w, h, 0, 0, w, h);
      onCapture(dst.toDataURL('image/jpeg', 0.92));
    };
    img.src = capturedDataUrl;
  };

  const retake = () => {
    capturingRef.current = false;
    setCapturedDataUrl(null);
    setCorners(null);
    stableCountRef.current = 0;
    lastCornersRef.current = null;
    setDetected(false);
    setPhase('camera');
  };

  // ── CROP RENDER ──────────────────────────────────────────────────
  if (phase === 'crop' && capturedDataUrl && corners) {
    return <CropScreen
      dataUrl={capturedDataUrl}
      imgW={imgSize.w}
      imgH={imgSize.h}
      corners={corners}
      setCorners={setCorners}
      onConfirm={confirmCrop}
      onRetake={retake}
    />;
  }

  // Camera phase
  return (
    <div style={{ position: 'fixed', inset: 0, background: '#000', zIndex: 9999, display: 'flex', flexDirection: 'column' }}>
      <div style={{ position: 'relative', flex: 1, overflow: 'hidden' }}>
        <video ref={videoRef} style={{ width: '100%', height: '100%', objectFit: 'cover' }} playsInline muted />
        <canvas ref={overlayCanvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }} />
        <canvas ref={canvasRef} style={{ display: 'none' }} />

        <div style={{
          position: 'absolute', top: 20, left: '50%', transform: 'translateX(-50%)',
          background: detected ? 'rgba(0,160,70,0.92)' : 'rgba(0,0,0,0.72)',
          color: '#fff', padding: '8px 20px', borderRadius: 20,
          fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap'
        }}>
          {detected ? '🟢 ' + status : '🔍 ' + status}
        </div>

        {/* Dotted guide when nothing detected */}
        {!detected && (
          <div style={{
            position: 'absolute', top: '8%', left: '5%', right: '5%', bottom: '18%',
            border: '2px dashed rgba(255,255,255,0.4)', borderRadius: 12, pointerEvents: 'none',
            display: 'flex', alignItems: 'center', justifyContent: 'center'
          }}>
            <span style={{ color: 'rgba(255,255,255,0.35)', fontSize: 13 }}>Place document inside</span>
          </div>
        )}
      </div>

      <div style={{ background: '#111', padding: '16px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <button onClick={onClose} style={{ background: 'rgba(255,255,255,0.12)', color: '#fff', border: 'none', borderRadius: 10, padding: '10px 20px', fontSize: 15, cursor: 'pointer' }}>
          Cancel
        </button>
        <button onClick={takePhoto} style={{
          background: '#fff', color: '#000', border: 'none', borderRadius: 50,
          width: 64, height: 64, fontSize: 26, fontWeight: 700, cursor: 'pointer',
          boxShadow: '0 0 0 4px rgba(255,255,255,0.3)'
        }}>
          📸
        </button>
        <div style={{ width: 80 }} />
      </div>
    </div>
  );
}

// ── MAIN APP ────────────────────────────────────────────────────────────────
function App() {
  const [batches, setBatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState('batches');
  const [selectedBatch, setSelectedBatch] = useState(null);
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [selectedExam, setSelectedExam] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [modalType, setModalType] = useState('');
  const [newName, setNewName] = useState('');
  const [newExamName, setNewExamName] = useState('');
  const [newScore, setNewScore] = useState('');
  const [newStudentPhoto, setNewStudentPhoto] = useState(null);
  const [saving, setSaving] = useState(false);
  const [printQRs, setPrintQRs] = useState(null);
  const [pendingDeepLink, setPendingDeepLink] = useState(null);
  const [showScanner, setShowScanner] = useState(false);
  const [scanningExamId, setScanningExamId] = useState(null);
  const [imageViewer, setImageViewer] = useState(null); // { images, index }

  const fileInputRef = useRef(null);
  const studentPhotoInputRef = useRef(null);

  useEffect(() => {
    fetchBatches();
    const params = new URLSearchParams(window.location.search);
    const batchId = params.get('batch');
    const studentId = params.get('student');
    if (batchId && studentId) setPendingDeepLink({ batchId, studentId });
  }, []);

  const fetchBatches = async () => {
    try {
      setLoading(true);
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);
      const res = await fetch(`${API}/batches`, { signal: controller.signal });
      clearTimeout(timeoutId);
      const data = await res.json();
      setBatches(data);
    } catch (err) {
      if (err.name === 'AbortError') {
        alert('Connection timed out. Please try again.');
      } else {
        alert('Cannot connect to server. Check your internet connection.');
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!pendingDeepLink || batches.length === 0) return;
    const { batchId, studentId } = pendingDeepLink;
    const batch = batches.find(b => b._id === batchId);
    if (!batch) return;
    const student = batch.students.find(s => s._id === studentId);
    if (!student) return;
    setSelectedBatch(batch);
    setSelectedStudent(student);
    setView('exams');
    setPendingDeepLink(null);
  }, [pendingDeepLink, batches]);

  const updateBatchInState = (updatedBatch) => {
    setBatches(prev => prev.map(b => b._id === updatedBatch._id ? updatedBatch : b));
    if (selectedBatch?._id === updatedBatch._id) setSelectedBatch(updatedBatch);
  };

  const goToStudents = (batch) => { setSelectedBatch(batch); setView('students'); };
  const goToExams = (student) => { setSelectedStudent(student); setView('exams'); };
  const goToExamDetail = (exam) => { setSelectedExam(exam); setView('examDetail'); };

  const goBack = () => {
    if (view === 'examDetail') { setView('exams'); setSelectedExam(null); }
    else if (view === 'exams') { setView('students'); setSelectedStudent(null); }
    else if (view === 'students') { setView('batches'); setSelectedBatch(null); }
  };

  const openModal = (type) => {
    setModalType(type); setShowModal(true);
    setNewName(''); setNewExamName(''); setNewScore(''); setNewStudentPhoto(null);
  };
  const closeModal = () => {
    setShowModal(false);
    setNewName(''); setNewExamName(''); setNewScore(''); setNewStudentPhoto(null);
  };

  const saveBatch = async () => {
    if (!newName) return;
    setSaving(true);
    try {
      const res = await fetch(`${API}/batches`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName })
      });
      const newBatch = await res.json();
      setBatches(prev => [...prev, newBatch]);
      closeModal();
    } catch { alert('Error saving batch.'); }
    setSaving(false);
  };

  const saveStudent = async () => {
    if (!newName || !selectedBatch) return;
    setSaving(true);
    try {
      const res = await fetch(`${API}/batches/${selectedBatch._id}/students`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName, photo: newStudentPhoto })
      });
      const updatedBatch = await res.json();
      updateBatchInState(updatedBatch);
      closeModal();
    } catch { alert('Error saving student.'); }
    setSaving(false);
  };

  const saveExam = async () => {
    if (!newExamName || !newScore || !selectedStudent) return;
    setSaving(true);
    try {
      const res = await fetch(`${API}/batches/${selectedBatch._id}/students/${selectedStudent._id}/exams`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newExamName, score: parseInt(newScore) })
      });
      const updatedBatch = await res.json();
      updateBatchInState(updatedBatch);
      const updatedStudent = updatedBatch.students.find(s => s._id === selectedStudent._id);
      if (updatedStudent) setSelectedStudent(updatedStudent);
      closeModal();
    } catch { alert('Error saving exam.'); }
    setSaving(false);
  };

  const deleteBatch = async (id, e) => {
    e.stopPropagation();
    if (!window.confirm('Delete this batch?')) return;
    try {
      await fetch(`${API}/batches/${id}`, { method: 'DELETE' });
      setBatches(prev => prev.filter(b => b._id !== id));
    } catch { alert('Error deleting batch.'); }
  };

  const deleteStudent = async (studentId, e) => {
    e.stopPropagation();
    if (!window.confirm('Delete this student?')) return;
    try {
      const res = await fetch(`${API}/batches/${selectedBatch._id}/students/${studentId}`, { method: 'DELETE' });
      const updatedBatch = await res.json();
      updateBatchInState(updatedBatch);
    } catch { alert('Error deleting student.'); }
  };

  const deleteExam = async (examId, e) => {
    if (e) e.stopPropagation();
    if (!window.confirm('Delete this exam?')) return;
    try {
      const res = await fetch(`${API}/batches/${selectedBatch._id}/students/${selectedStudent._id}/exams/${examId}`, { method: 'DELETE' });
      const updatedBatch = await res.json();
      updateBatchInState(updatedBatch);
      const updatedStudent = updatedBatch.students.find(s => s._id === selectedStudent._id);
      if (updatedStudent) setSelectedStudent(updatedStudent);
      if (view === 'examDetail') { setView('exams'); setSelectedExam(null); }
    } catch { alert('Error deleting exam.'); }
  };

  const deleteImagePage = async (examId, index) => {
    if (!window.confirm(`Delete page ${index + 1}?`)) return;
    try {
      const res = await fetch(`${API}/batches/${selectedBatch._id}/students/${selectedStudent._id}/exams/${examId}/remove-image`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ index })
      });
      const updatedBatch = await res.json();
      updateBatchInState(updatedBatch);
      const updatedStudent = updatedBatch.students.find(s => s._id === selectedStudent._id);
      if (updatedStudent) {
        setSelectedStudent(updatedStudent);
        const updatedExam = updatedStudent.exams.find(ex => ex._id === examId);
        if (updatedExam) setSelectedExam(updatedExam);
      }
    } catch { alert('Error deleting page.'); }
  };

  const uploadImage = async (examId, imageData) => {
    try {
      const res = await fetch(`${API}/batches/${selectedBatch._id}/students/${selectedStudent._id}/exams/${examId}/image`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: imageData })
      });
      const updatedBatch = await res.json();
      updateBatchInState(updatedBatch);
      const updatedStudent = updatedBatch.students.find(s => s._id === selectedStudent._id);
      if (updatedStudent) {
        setSelectedStudent(updatedStudent);
        const updatedExam = updatedStudent.exams.find(ex => ex._id === examId);
        if (updatedExam) setSelectedExam(updatedExam);
      }
    } catch { alert('Error saving image.'); }
  };

  const triggerFileInput = (examId) => {
    fileInputRef.current.setAttribute('data-exam-id', examId);
    fileInputRef.current.click();
  };

  const handleFileChange = async (e) => {
    const examId = fileInputRef.current.getAttribute('data-exam-id');
    const files = Array.from(e.target.files);
    for (const file of files) {
      const compressed = await compressImage(file, 1200, 0.75);
      await uploadImage(examId, compressed);
    }
    e.target.value = '';
  };
  const openScanner = (examId) => {
    setScanningExamId(examId);
    setShowScanner(true);
  };

  const handleScanCapture = async (imageData) => {
    setShowScanner(false);
    if (scanningExamId) {
      await uploadImage(scanningExamId, imageData);
      setScanningExamId(null);
    }
  };

  const generateBatchQRs = async () => {
    const results = await Promise.all(
      selectedBatch.students.map(async (student) => {
        const url = `${window.location.origin}${window.location.pathname}?batch=${selectedBatch._id}&student=${student._id}`;
        const dataUrl = await QRCode.toDataURL(url, { width: 400, margin: 2 });
        return { name: student.name, photo: student.photo, dataUrl };
      })
    );
    setPrintQRs(results);
  };

  if (loading) return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '80vh', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontSize: 36 }}>⏳</div>
      <p style={{ color: '#8E8E93', fontSize: 16 }}>Loading...</p>
    </div>
  );

  const renderBatches = () => (
    <>
      <h1 className="title">My Batches</h1>
      {batches.map(batch => (
        <div key={batch._id} className="card clickable" onClick={() => goToStudents(batch)}>
          <div className="card-content">
            <div>
              <h2 className="card-title">🎌 {batch.name}</h2>
              <p className="card-subtitle">{batch.students.length} students</p>
            </div>
            <button className="delete-btn-icon" onClick={(e) => deleteBatch(batch._id, e)}>✕</button>
          </div>
        </div>
      ))}
      <button className="add-button" onClick={() => openModal('batch')}>+ Add New Batch</button>
    </>
  );

  const renderStudents = () => (
    <>
      <button className="back-btn" onClick={goBack}>←</button>
      <div className="header-with-back">
        <h1 className="title">{selectedBatch.name}</h1>
      </div>
      <h2 className="section-title">Students</h2>
      {selectedBatch.students.map(student => (
        <div key={student._id} className="card student-card clickable" onClick={() => goToExams(student)}>
          <div className="card-content">
            <div className="student-card-left">
              {student.photo
                ? <img src={student.photo} alt={student.name} className="student-avatar" />
                : <span className="student-avatar-icon">👤</span>
              }
              <div>
                <h3 className="card-title">{student.name}</h3>
                <p className="card-subtitle">{student.exams.length} exams</p>
              </div>
            </div>
            <button className="delete-btn-icon" onClick={(e) => deleteStudent(student._id, e)}>✕</button>
          </div>
        </div>
      ))}
      <button className="add-button" onClick={() => openModal('student')}>+ Add Student</button>
      {selectedBatch.students.length > 0 && (
        <button className="print-qr-button" onClick={generateBatchQRs}>🖨 Print QR Codes</button>
      )}
    </>
  );

  const renderExams = () => (
    <>
      <button className="back-btn" onClick={goBack}>←</button>
      <div className="student-profile-header">
        {selectedStudent.photo
          ? <img src={selectedStudent.photo} alt={selectedStudent.name} className="student-profile-avatar" />
          : <span className="student-profile-icon">👤</span>
        }
        <h1 className="student-profile-name">{selectedStudent.name}</h1>
      </div>
      <h2 className="section-title">Exams</h2>
      {selectedStudent.exams.map(exam => (
        <div key={exam._id} className="card exam-card clickable" onClick={() => goToExamDetail(exam)}>
          <div className="card-content">
            <div>
              <h3 className="card-title">📝 {exam.name}</h3>
              <p className="card-subtitle">{exam.date} • Score: {exam.score}/100</p>
            </div>
            <div className="exam-right">
              {(exam.images?.length > 0 || exam.image) && <span className="has-photo-badge">📷</span>}
              <button className="delete-btn-icon" onClick={(e) => deleteExam(exam._id, e)}>✕</button>
            </div>
          </div>
        </div>
      ))}
      <button className="add-button" onClick={() => openModal('exam')}>+ Add Exam</button>
    </>
  );

  const renderExamDetail = () => {
    const allImages = selectedExam.images?.length > 0
      ? selectedExam.images
      : selectedExam.image ? [selectedExam.image] : [];

    return (
      <>
        <button className="back-btn" onClick={goBack}>←</button>
        <div className="header-with-back">
          <h1 className="title">{selectedExam.name}</h1>
        </div>
        <div className="exam-detail-info">
          <span className="detail-badge">📅 {selectedExam.date}</span>
          <span className="detail-badge">🎯 Score: {selectedExam.score}/100</span>
        </div>

        <h2 className="section-title">Exam Pages ({allImages.length} pages)</h2>

        {/* Action buttons — always visible */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 16, padding: '0 4px' }}>
          <button className="save-btn" style={{ flex: 1 }} onClick={() => openScanner(selectedExam._id)}>
            📷 Scan Page
          </button>
          <button className="cancel-btn" style={{ flex: 1 }} onClick={() => triggerFileInput(selectedExam._id)}>
            🖼️ Upload Page
          </button>
        </div>

        {/* Document pages — vertical list like Files app */}
        {allImages.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '32px 0' }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>📄</div>
            <p style={{ color: '#8E8E93' }}>No pages yet. Scan or upload to add.</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '0 4px' }}>
            {allImages.map((img, idx) => (
              <div key={idx} style={{
                background: '#fff',
                borderRadius: 12,
                boxShadow: '0 2px 12px rgba(0,0,0,0.12)',
                overflow: 'hidden',
                position: 'relative'
              }}>
                {/* Page header */}
                <div style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '8px 12px', background: '#f5f5f7', borderBottom: '1px solid #e5e5ea'
                }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: '#3a3a3c' }}>Page {idx + 1}</span>
                  <button
                    onClick={(e) => { e.stopPropagation(); deleteImagePage(selectedExam._id, idx); }}
                    style={{
                      background: 'none', border: 'none', color: '#ff3b30',
                      fontSize: 13, fontWeight: 600, cursor: 'pointer', padding: '2px 6px'
                    }}
                  >
                    🗑 Delete
                  </button>
                </div>
                {/* Document image — A4 proportions, full width */}
                <img
                  src={img}
                  alt={`Page ${idx + 1}`}
                  onClick={() => setImageViewer({ images: allImages, index: idx })}
                  style={{
                    width: '100%',
                    aspectRatio: '210 / 297',
                    objectFit: 'contain',
                    display: 'block',
                    background: '#fafafa',
                    cursor: 'zoom-in'
                  }}
                />
              </div>
            ))}
          </div>
        )}

        {/* Spacer before delete button */}
        <div style={{ height: 16 }} />

        {/* Hidden — keep old empty state removed */}
        {false && (
          <div></div>
        )}

        <button className="delete-button-full" onClick={(e) => deleteExam(selectedExam._id, e)}>
          🗑 Delete Exam
        </button>

        <input
          type="file"
          ref={fileInputRef}
          style={{ display: 'none' }}
          accept="image/*"
          multiple
          onChange={handleFileChange}
        />
      </>
    );
  };

  const renderModal = () => {
    if (!showModal) return null;
    const titles = { batch: 'Add New Batch', student: 'Add New Student', exam: 'Add New Exam' };
    return (
      <div className="modal-overlay">
        <div className="modal">
          <h2 className="modal-title">{titles[modalType]}</h2>
          {modalType === 'exam' ? (
            <>
              <div className="form-group">
                <label>Exam Name:</label>
                <input type="text" value={newExamName} onChange={(e) => setNewExamName(e.target.value)} placeholder="e.g., Quiz 1, Midterm, Finals" />
              </div>
              <div className="form-group">
                <label>Score:</label>
                <input type="number" value={newScore} onChange={(e) => setNewScore(e.target.value)} placeholder="Score (0-100)" min="0" max="100" />
              </div>
            </>
          ) : modalType === 'student' ? (
            <>
              <div className="form-group">
                <label>Name:</label>
                <input type="text" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g., Juan Cruz" />
              </div>
              <div className="form-group">
                <label>Photo (optional):</label>
                <div className="student-photo-upload" onClick={() => studentPhotoInputRef.current.click()}>
                  {newStudentPhoto
                    ? <img src={newStudentPhoto} alt="Preview" className="student-photo-preview" />
                    : <><span className="upload-icon" style={{ fontSize: 28 }}>👤</span><p style={{ margin: 0, fontSize: 13, color: '#8E8E93' }}>Tap to upload photo</p></>
                  }
                </div>
                <input
                  type="file"
                  ref={studentPhotoInputRef}
                  style={{ display: 'none' }}
                  accept="image/*"
                  capture="user"
                  onChange={async (e) => {
                    const file = e.target.files[0];
                    if (!file) return;
                    const compressed = await compressImage(file, 400, 0.7);
                    setNewStudentPhoto(compressed);
                    e.target.value = '';
                  }}
                />
              </div>
            </>
          ) : (
            <div className="form-group">
              <label>Name:</label>
              <input type="text" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g., N5 Saturday 2PM" />
            </div>
          )}
          <div className="modal-buttons">
            <button className="cancel-btn" onClick={closeModal} disabled={saving}>Cancel</button>
            <button className="save-btn" disabled={saving}
              onClick={modalType === 'batch' ? saveBatch : modalType === 'student' ? saveStudent : saveExam}>
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    );
  };

  const renderPrintQRs = () => {
    if (!printQRs) return null;
    return (
      <div className="print-overlay">
        <div className="print-toolbar no-print">
          <span className="print-toolbar-title">QR Codes — {selectedBatch.name}</span>
          <div className="print-toolbar-actions">
            <button className="print-go-btn" onClick={() => window.print()}>🖨 Print</button>
            <button className="print-close-btn" onClick={() => setPrintQRs(null)}>✕ Close</button>
          </div>
        </div>
        <div className="print-sheet">
          {printQRs.map((item, i) => (
            <div key={i} className="qr-card-print">
              {item.photo
                ? <img src={item.photo} alt={item.name} className="qr-print-avatar" />
                : <span className="qr-print-icon">👤</span>
              }
              <img src={item.dataUrl} alt="QR" className="qr-print-code" />
              <p className="qr-print-name">{item.name}</p>
              <p className="qr-print-batch">{selectedBatch.name}</p>
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div>
      {view === 'batches' && renderBatches()}
      {view === 'students' && renderStudents()}
      {view === 'exams' && renderExams()}
      {view === 'examDetail' && renderExamDetail()}
      {renderModal()}
      {renderPrintQRs()}
      {showScanner && (
        <DocumentScanner
          onCapture={handleScanCapture}
          onClose={() => { setShowScanner(false); setScanningExamId(null); }}
        />
      )}
      {imageViewer && (
        <ImageViewer
          images={imageViewer.images}
          startIndex={imageViewer.index}
          onClose={() => setImageViewer(null)}
        />
      )}
    </div>
  );
}

export default App;