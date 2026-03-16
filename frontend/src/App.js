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
    console.log('[draw] canvas:', canvas ? 'ok' : 'NULL', 'container:', container ? 'ok' : 'NULL');
    if (!canvas || !container) return;
    const cW = container.offsetWidth;
    const cH = container.offsetHeight;
    console.log('[draw] container size:', cW, 'x', cH, 'imgW:', imgW, 'imgH:', imgH, 'img:', img ? img.naturalWidth+'x'+img.naturalHeight : 'NULL');
    if (!cW || !cH || !imgW || !imgH) return;

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
    console.log('[CropScreen] mounted, dataUrl length:', dataUrl ? dataUrl.length : 0);
    console.log('[CropScreen] imgW:', imgW, 'imgH:', imgH);
    console.log('[CropScreen] corners:', corners);
    const img = new Image();
    img.onload = () => {
      console.log('[CropScreen] image loaded:', img.naturalWidth, img.naturalHeight);
      loadedImgRef.current = img;
      setTimeout(() => {
        const container = containerRef.current;
        const canvas = canvasRef.current;
        console.log('[CropScreen] container:', container ? container.offsetWidth + 'x' + container.offsetHeight : 'NULL');
        console.log('[CropScreen] canvas:', canvas ? 'exists' : 'NULL');
        draw(img, cornersRef.current);
      }, 50);
    };
    img.onerror = (e) => console.error('[CropScreen] image FAILED to load', e);
    img.src = dataUrl;
    console.log('[CropScreen] set img.src, type:', dataUrl ? dataUrl.substring(0, 30) : 'empty');
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

    // Read dimensions and capture frame BEFORE stopping the stream
    const W = video.videoWidth || video.clientWidth;
    const H = video.videoHeight || video.clientHeight;
    canvas.width = W; canvas.height = H;
    canvas.getContext('2d').drawImage(video, 0, 0, W, H);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.95);

    // Stop stream only after capture
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());

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
      // Sort corners robustly into TL, TR, BR, BL regardless of drag order
      const pts = [...corners];
      const cx = pts.reduce((s,p) => s+p.x, 0) / 4;
      const cy = pts.reduce((s,p) => s+p.y, 0) / 4;
      // Classify by angle from centroid
      pts.sort((a, b) => Math.atan2(a.y-cy, a.x-cx) - Math.atan2(b.y-cy, b.x-cx));
      // After angle sort: left-top, left-bottom, right-bottom, right-top (CCW from -π)
      // Re-sort: top-left has min(x+y), top-right has min(y-x), etc.
      const sumSort  = [...pts].sort((a,b) => (a.x+a.y)-(b.x+b.y));
      const diffSort = [...pts].sort((a,b) => (a.x-a.y)-(b.x-b.y));
      const tl = sumSort[0];
      const br = sumSort[3];
      const tr = diffSort[3];
      const bl = diffSort[0];

      // Output dimensions based on actual edge lengths
      const wTop   = Math.hypot(tr.x-tl.x, tr.y-tl.y);
      const wBot   = Math.hypot(br.x-bl.x, br.y-bl.y);
      const hLeft  = Math.hypot(bl.x-tl.x, bl.y-tl.y);
      const hRight = Math.hypot(br.x-tr.x, br.y-tr.y);
      const outW   = Math.round(Math.max(wTop, wBot));
      const outH   = Math.round(Math.max(hLeft, hRight));

      // ── Compute inverse homography (dest → src) ──────────────────
      // Source quad: tl, tr, br, bl
      // Dest quad:   (0,0), (W,0), (W,H), (0,H)
      // Solve 8 unknowns h00..h22 (h22=1) using 8 equations.
      // Using the direct linear transform (DLT).

      const sx0=tl.x, sy0=tl.y;
      const sx1=tr.x, sy1=tr.y;
      const sx2=br.x, sy2=br.y;
      const sx3=bl.x, sy3=bl.y;
      const dx0=0,    dy0=0;
      const dx1=outW, dy1=0;
      const dx2=outW, dy2=outH;
      const dx3=0,    dy3=outH;

      // Build 8x8 matrix A and vector b for Ah=b
      // For each correspondence (dxi,dyi) -> (sxi,syi):
      //   sxi = (h0*dxi + h1*dyi + h2) / (h6*dxi + h7*dyi + 1)
      //   syi = (h3*dxi + h4*dyi + h5) / (h6*dxi + h7*dyi + 1)
      const corrPts = [
        [dx0,dy0,sx0,sy0],[dx1,dy1,sx1,sy1],
        [dx2,dy2,sx2,sy2],[dx3,dy3,sx3,sy3],
      ];
      const A = [], b = [];
      for (const [dx,dy,sx,sy] of corrPts) {
        A.push([dx, dy, 1,  0,  0,  0, -sx*dx, -sx*dy]);
        A.push([ 0,  0, 0, dx, dy,  1, -sy*dx, -sy*dy]);
        b.push(sx); b.push(sy);
      }

      // Gaussian elimination to solve Ah=b
      const n = 8;
      const M = A.map((row, i) => [...row, b[i]]);
      for (let col = 0; col < n; col++) {
        // Pivot
        let maxRow = col;
        for (let r = col+1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[maxRow][col])) maxRow = r;
        [M[col], M[maxRow]] = [M[maxRow], M[col]];
        const pivot = M[col][col];
        if (Math.abs(pivot) < 1e-10) continue;
        for (let r = col+1; r < n; r++) {
          const f = M[r][col] / pivot;
          for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
        }
      }
      const h = new Array(n).fill(0);
      for (let r = n-1; r >= 0; r--) {
        h[r] = M[r][n];
        for (let c = r+1; c < n; c++) h[r] -= M[r][c] * h[c];
        h[r] /= M[r][r];
      }
      // h = [h0,h1,h2,h3,h4,h5,h6,h7], h8=1
      const [h0,h1,h2,h3,h4,h5,h6,h7] = h;

      // ── Rasterize ─────────────────────────────────────────────────
      const srcCanvas = document.createElement('canvas');
      srcCanvas.width  = img.naturalWidth  || imgSize.w;
      srcCanvas.height = img.naturalHeight || imgSize.h;
      srcCanvas.getContext('2d').drawImage(img, 0, 0);
      const srcData = srcCanvas.getContext('2d').getImageData(0, 0, srcCanvas.width, srcCanvas.height);
      const sw = srcData.width, sh = srcData.height;

      const dst = document.createElement('canvas');
      dst.width = outW; dst.height = outH;
      const outData = dst.getContext('2d').createImageData(outW, outH);

      for (let dy = 0; dy < outH; dy++) {
        for (let dx = 0; dx < outW; dx++) {
          const w_  = h6*dx + h7*dy + 1;
          const sx  = (h0*dx + h1*dy + h2) / w_;
          const sy  = (h3*dx + h4*dy + h5) / w_;

          // Bilinear sample from source
          const x0 = Math.floor(sx), y0 = Math.floor(sy);
          const x1 = x0+1,           y1 = y0+1;
          const fx = sx-x0,           fy = sy-y0;
          const di = (dy*outW + dx)*4;

          if (x0<0||y0<0||x1>=sw||y1>=sh) {
            outData.data[di+3]=0; continue;
          }
          const i00=(y0*sw+x0)*4, i10=(y0*sw+x1)*4;
          const i01=(y1*sw+x0)*4, i11=(y1*sw+x1)*4;
          for (let c=0;c<3;c++) {
            outData.data[di+c] = Math.round(
              srcData.data[i00+c]*(1-fx)*(1-fy) +
              srcData.data[i10+c]*fx*(1-fy) +
              srcData.data[i01+c]*(1-fx)*fy +
              srcData.data[i11+c]*fx*fy
            );
          }
          outData.data[di+3] = 255;
        }
      }
      dst.getContext('2d').putImageData(outData, 0, 0);
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


// ── LOGIN SCREEN ─────────────────────────────────────────────────────────────
const ADMIN_USER = 'sagebulacan97';
const ADMIN_PASS = 'July142018';
const PHGIC_USER = 'PHGIC';
const PHGIC_PASS = 'phgic';
const AUTH_KEY = 'sage_auth';
const ROLE_KEY = 'sage_role'; // 'admin' or 'viewer'

const TEACHER_KEY = 'sage_teacher';

// ── TEACHER SELECT SCREEN ─────────────────────────────────────────────────────
function TeacherSelect({ onSelect }) {
  const [teachers, setTeachers] = useState([]);
  const [loadingT, setLoadingT] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState('');
  const [newEmoji, setNewEmoji] = useState('👩‍🏫');
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState(null);
  const EMOJIS = ['👩‍🏫','👨‍🏫','👩','👨','🧑‍🏫'];

  useEffect(() => {
    fetch(`${API}/teachers`)
      .then(r => r.json())
      .then(data => { setTeachers(data); setLoadingT(false); })
      .catch(() => setLoadingT(false));
  }, []);

  const addTeacher = async () => {
    if (!newName.trim()) return;
    setSaving(true);
    const res = await fetch(`${API}/teachers`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName.trim(), emoji: newEmoji })
    });
    const t = await res.json();
    setTeachers(prev => [...prev, t]);
    setNewName(''); setShowAdd(false); setSaving(false);
  };

  const deleteTeacher = async (id) => {
    await fetch(`${API}/teachers/${id}`, { method: 'DELETE' });
    setTeachers(prev => prev.filter(t => t._id !== id));
    setDeleteId(null);
  };

  const uploadSignature = async (teacherId, file) => {
    const compressed = await compressImage(file, 600, 0.7);
    const res = await fetch(`${API}/teachers/${teacherId}/signature`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ signature: compressed })
    });
    const updated = await res.json();
    setTeachers(prev => prev.map(t => t._id === teacherId ? updated : t));
  };

  const uploadTeacherPhoto = async (teacherId, file) => {
    const compressed = await compressImage(file, 400, 0.8);
    const res = await fetch(`${API}/teachers/${teacherId}/photo`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ photo: compressed })
    });
    const updated = await res.json();
    setTeachers(prev => prev.map(t => t._id === teacherId ? { ...t, photo: updated.photo } : t));
  };

  return (
    <div style={{ minHeight: '100vh', background: '#f2f2f7', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '40px 20px' }}>
      <img src={LOGO_DATA_URL} alt="Sage Asian" style={{ width: '55%', maxWidth: 240, marginBottom: 28, objectFit: 'contain' }} />
      <h2 style={{ fontSize: 20, fontWeight: 700, color: '#1c1c1e', marginBottom: 6 }}>Select Teacher</h2>
      <p style={{ fontSize: 13, color: '#8e8e93', marginBottom: 24 }}>Tap your name to continue</p>
      <div style={{ width: '100%', maxWidth: 400, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {loadingT && <p style={{ textAlign: 'center', color: '#8e8e93' }}>Loading...</p>}
        {teachers.map(t => (
          <div key={t._id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button onClick={() => onSelect(t)} style={{
              flex: 1, display: 'flex', alignItems: 'center', gap: 14,
              background: '#fff', border: 'none', borderRadius: 14,
              padding: '12px 20px', fontSize: 17, fontWeight: 600, color: '#1c1c1e',
              boxShadow: '0 2px 10px rgba(0,0,0,0.08)', cursor: 'pointer',
            }}>
              {/* Photo or emoji — tap to change */}
              <label onClick={e => e.stopPropagation()} style={{ cursor: 'pointer', flexShrink: 0, position: 'relative' }} title="Tap to change photo">
                {t.photo
                  ? <img src={t.photo} alt={t.name} style={{ width: 46, height: 46, borderRadius: '50%', objectFit: 'cover', border: '2px solid #e5e5ea' }} />
                  : <span style={{ fontSize: 36, lineHeight: 1 }}>{t.emoji}</span>
                }
                <span style={{ position: 'absolute', bottom: -2, right: -4, background: '#007AFF', borderRadius: '50%', width: 18, height: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: '#fff' }}>✎</span>
                <input type="file" accept="image/*" style={{ display: 'none' }}
                  onChange={e => e.target.files[0] && uploadTeacherPhoto(t._id, e.target.files[0])} />
              </label>
              {t.name}
              <span style={{ marginLeft: 'auto', color: '#c7c7cc', fontSize: 20 }}>›</span>
            </button>
            {deleteId === t._id ? (
              <div style={{ display: 'flex', gap: 6 }}>
                <button onClick={() => deleteTeacher(t._id)} style={{ background: '#ff3b30', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 12px', fontWeight: 700, cursor: 'pointer' }}>Delete</button>
                <button onClick={() => setDeleteId(null)} style={{ background: '#e5e5ea', border: 'none', borderRadius: 8, padding: '8px 12px', cursor: 'pointer' }}>Cancel</button>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                <label title="Upload signature" style={{ cursor: 'pointer', fontSize: 18, padding: '4px 8px', color: t.signature ? '#34c759' : '#8e8e93' }}>
                  ✍️
                  <input type="file" accept="image/*" style={{ display: 'none' }}
                    onChange={e => e.target.files[0] && uploadSignature(t._id, e.target.files[0])} />
                </label>
                <button onClick={() => setDeleteId(t._id)} style={{ background: 'none', border: 'none', color: '#ff3b30', fontSize: 18, cursor: 'pointer', padding: '4px 8px' }}>✕</button>
              </div>
            )}
          </div>
        ))}
        {showAdd ? (
          <div style={{ background: '#fff', borderRadius: 14, padding: 16, boxShadow: '0 2px 10px rgba(0,0,0,0.08)' }}>
            <p style={{ fontSize: 13, fontWeight: 600, color: '#6e6e73', marginBottom: 8 }}>Choose emoji</p>
            <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
              {EMOJIS.map(e => (
                <button key={e} onClick={() => setNewEmoji(e)} style={{ fontSize: 24, background: newEmoji === e ? '#e8f4ff' : 'none', border: newEmoji === e ? '2px solid #007AFF' : '2px solid transparent', borderRadius: 8, padding: '4px 8px', cursor: 'pointer' }}>{e}</button>
              ))}
            </div>
            <input type="text" value={newName} onChange={e => setNewName(e.target.value)}
              placeholder="Teacher name" autoFocus
              style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1.5px solid #e5e5ea', fontSize: 15, marginBottom: 10, boxSizing: 'border-box' }} />
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={addTeacher} disabled={saving || !newName.trim()} style={{ flex: 1, background: '#8B0000', color: '#fff', border: 'none', borderRadius: 10, padding: 12, fontSize: 15, fontWeight: 700, cursor: 'pointer' }}>
                {saving ? 'Saving...' : 'Add Teacher'}
              </button>
              <button onClick={() => { setShowAdd(false); setNewName(''); }} style={{ background: '#e5e5ea', border: 'none', borderRadius: 10, padding: '12px 16px', fontSize: 15, cursor: 'pointer' }}>Cancel</button>
            </div>
          </div>
        ) : (
          <button onClick={() => setShowAdd(true)} style={{ background: '#fff', border: '2px dashed #c7c7cc', borderRadius: 14, padding: 14, fontSize: 15, fontWeight: 600, color: '#007AFF', cursor: 'pointer' }}>
            + Add Teacher
          </button>
        )}
      </div>
      <button onClick={() => { localStorage.removeItem(AUTH_KEY); localStorage.removeItem(TEACHER_KEY); window.location.reload(); }}
        style={{ marginTop: 36, background: 'none', border: 'none', color: '#ff3b30', fontSize: 14, cursor: 'pointer' }}>
        Logout
      </button>
    </div>
  );
}

function LoginScreen({ onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [showPass, setShowPass] = useState(false);

  const handleLogin = () => {
    if (username === ADMIN_USER && password === ADMIN_PASS) {
      localStorage.setItem(AUTH_KEY, 'true');
      localStorage.setItem(ROLE_KEY, 'admin');
      onLogin('admin');
    } else if (username === PHGIC_USER && password === PHGIC_PASS) {
      localStorage.setItem(AUTH_KEY, 'true');
      localStorage.setItem(ROLE_KEY, 'viewer');
      onLogin('viewer');
    } else {
      setError('Invalid username or password.');
    }
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, background: '#f2f2f7',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      padding: '32px 24px', zIndex: 99999,
    }}>
      <img src={LOGO_DATA_URL} alt="Sage Asian" style={{ width: '65%', maxWidth: 280, marginBottom: 32, objectFit: 'contain' }} />
      <div style={{ width: '100%', maxWidth: 360, background: '#fff', borderRadius: 16, padding: '28px 24px', boxShadow: '0 4px 24px rgba(0,0,0,0.10)' }}>
        <h2 style={{ textAlign: 'center', marginBottom: 20, fontSize: 20, fontWeight: 700, color: '#1c1c1e' }}>Login</h2>
        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 13, color: '#6e6e73', fontWeight: 600 }}>Username</label>
          <input
            type="text"
            value={username}
            onChange={e => { setUsername(e.target.value); setError(''); }}
            placeholder="Enter username"
            style={{ display: 'block', width: '100%', marginTop: 6, padding: '12px 14px', borderRadius: 10, border: '1.5px solid #e5e5ea', fontSize: 15, outline: 'none', boxSizing: 'border-box' }}
          />
        </div>
        <div style={{ marginBottom: 8 }}>
          <label style={{ fontSize: 13, color: '#6e6e73', fontWeight: 600 }}>Password</label>
          <div style={{ position: 'relative', marginTop: 6 }}>
            <input
              type={showPass ? 'text' : 'password'}
              value={password}
              onChange={e => { setPassword(e.target.value); setError(''); }}
              onKeyDown={e => e.key === 'Enter' && handleLogin()}
              placeholder="Enter password"
              style={{ display: 'block', width: '100%', padding: '12px 44px 12px 14px', borderRadius: 10, border: '1.5px solid #e5e5ea', fontSize: 15, outline: 'none', boxSizing: 'border-box' }}
            />
            <button onClick={() => setShowPass(p => !p)} style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: '#8e8e93' }}>
              {showPass ? '🙈' : '👁️'}
            </button>
          </div>
        </div>
        {error && <p style={{ color: '#ff3b30', fontSize: 13, marginBottom: 8, textAlign: 'center' }}>{error}</p>}
        <button
          onClick={handleLogin}
          style={{ width: '100%', marginTop: 16, padding: '14px', background: '#8B0000', color: '#fff', border: 'none', borderRadius: 10, fontSize: 16, fontWeight: 700, cursor: 'pointer' }}
        >
          Login
        </button>
      </div>
    </div>
  );
}

// ── MAIN APP ────────────────────────────────────────────────────────────────

const LOGO_DATA_URL = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wCEAAUFBQUFBQUGBgUICAcICAsKCQkKCxEMDQwNDBEaEBMQEBMQGhcbFhUWGxcpIBwcICkvJyUnLzkzMzlHREddXX0BBQUFBQUFBQYGBQgIBwgICwoJCQoLEQwNDA0MERoQExAQExAaFxsWFRYbFykgHBwgKS8nJScvOTMzOUdER11dff/CABEIALQBzgMBIgACEQEDEQH/xAAyAAEAAgMBAQAAAAAAAAAAAAAABAUCAwYBBwEBAAMBAQAAAAAAAAAAAAAAAAECAwQF/9oADAMBAAIQAxAAAALsgAAAeRZENE8JAAAAAAAAAAAAAAAAAAAAAAAAAAAwhafKXtxegAAAAAAAAAAAAAAAAAAAAAAAAAqigwp8se/sZHBTcL9jL4rPTHunB+7Yd2L5AAAAAAAAAAAAAAAAAAAAAAAVPEfTcab/ADLPfhz+tHT8abV+U/oteSn7TY381jlyyttOrpqZMWTwcW71rxtjnApbGnRcxd/KzXoZVVYzWQYTlolcD3dd866FuJ+cWsOjYwbZb5PG9lGkeRzMyJucI0eaWotmAAAAAAAAr6rlc+jHHNh6uWWnNXdYVBHUQa7s9ePOj63zTlrLTlp8a7VTtreTqrJ0adHsxx14NnKW1RTqurKrtLYKW65KL3OmHFrtZ4dBRznec7o3rdDQXvFK3VtzctfOBOsIe6qS7mtmNOUAAAAAAABTXOmLfPcIcnn9SVhs357wLrVaWxu98V0+VKxqoyb7m/Lmu1P00GdbPlrGZlF6K8rocWkRrmCtdZc3Z2xsedvdZL5bqatFhso4UWzylexpmzsJyz5HrqlMToa6xmvKW07CLyhfnAAAAAAAadyHO8v3fIU6q3HRJx9Pxs3Q2Nujbg9labO2F/s5Hob4WXvMxjso/MSy+h+86XKr0FrE3aibjlWnVe01QXsXZEg3Q9xKyopct02t6U83c7UHZeVGsvt/NWRRXvMbjstnPTSww460Oh84/cdZVaPS32cpFOx3atpqpr7TrvGlQd8zup7PkUVc3mt3Jte64u/LpmbYGM5dvq5fDXj6zRSdxplRWHKC811OMOgw5/0uPKrAts6cW2muSuvKZCx21ItcYOotZNCOhhVY6DZzY66PQ6JdTtj2hzdhaCriX4r4l2K/VajnLaaIcS3FJdgwz0zMGj6Xzfq+Y+fU6itOE2d77N+D877bWnzp9C2o+c2neUibSbQe305PK/28/JU7Zm1FflOFfnNxKmZOxK7OcK/yxFd5ZCj224rNk8VuVgKvy1HO6eoEi8hzAAAAAAABo3+TMPf7lbSo3RbXo6YsjGbjhBTqyZy0T41r6t8/2mcGNb1M2kxNbTafJpc60ucoXmWGW6m3673CptseYK0AAAAAAAAAAAAAAAAeejDMAEeQmazKx1abY7zPFp3Culb0301N5ja3NXO/ffTXAs9eeUOwgzDIUyAAAAAAAAAAAAAAAAAAAAAAAAAAA89AAAAAAAAAAAAAAAAD/8QAAv/aAAwDAQACAAMAAAAh888838888888888888888888888888880m888888888888888888888888884ZfIlc888888888888888888888889vPHcvx/wBh1he+cytFO/vPPPPPPPPLlj8pm0D/ALbzbuk7UdxMrzzzzzzzzylY23+sN302TRCkdSepTnzzzzzzzz4Wi6gTyCxAAyjxLahijTAwhxDTTxuyWNcAMWC527ayx7Y4x7gQwzyyxwy84B7bwdvJOyWyzwwwyzwzzzzzzzzykZlvqfRudPqP/wA88888888888888888f8ta9t+IU6X888888888888888888888g88888888888888888888888/8QAMBAAAgICAQMCBAYBBQEAAAAAAgMBBAAFEhETFRQWBhAhUCIxMzQ1QCMgJCUwMjb/2gAIAQEAAQcC/wCh/XsszWyyagfebX1rujUREUl/ebIyddw6cDTRWv7tJgMiOPf6lsorgVVuQUFHX7r8UWi9XUSjfucMV0dnjGRgmS8G2vImJ+rGrUEmloPWLPt/WM2m3RrlzgS2zYO22VHOCqAnkFzaBnl9rGeau55jYT9Kla7trYRERERH2/Ya+wzkwq3YbMm2ZnoI9InJgYnPwD1j8UfT8X56/VWLZckV1VlwvGNBQyXmNd16JeqwHPJvVRb2vk16lR18xruvRbBYEGewpLIg8nQxLlvHn8pvVYb2smemHtqAF0r3a1rrj7SK/TBnrETM9I6pu1Xlxx1uvXkYiesYxgKCSU5bx5/02KUyOm37VTZmCVDYnlwmOWSv8wCnL2iFDS0lOIvnaGdjt/S+E13TpUqhTV2jKBGSYszQewQ2HJUy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";

function SplashScreen({ onDone }) {
  const [phase, setPhase] = useState('enter');

  useEffect(() => {
    const t1 = setTimeout(() => setPhase('hold'), 800);
    const t2 = setTimeout(() => setPhase('exit'), 2300);
    const t3 = setTimeout(() => onDone && onDone(), 2900);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, []);

  const logoStyle = {
    enter: { opacity: 0, transform: 'scale(0.80)' },
    hold:  { opacity: 1, transform: 'scale(1)' },
    exit:  { opacity: 0, transform: 'scale(1.07)' },
  }[phase];

  return (
    <div style={{
      position: 'fixed', inset: 0,
      background: '#fff',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      zIndex: 99999,
      opacity: phase === 'exit' ? 0 : 1,
      transition: phase === 'exit' ? 'opacity 0.55s ease-in-out' : 'none',
    }}>
      <img
        src={LOGO_DATA_URL}
        alt="Sage Asian"
        style={{
          width: '62%',
          maxWidth: 300,
          objectFit: 'contain',
          opacity: logoStyle.opacity,
          transform: logoStyle.transform,
          transition: phase === 'enter'
            ? 'opacity 0.8s cubic-bezier(0.22,1,0.36,1), transform 0.8s cubic-bezier(0.22,1,0.36,1)'
            : phase === 'exit'
            ? 'opacity 0.45s ease-in, transform 0.45s ease-in'
            : 'none',
        }}
      />
      <div style={{
        marginTop: 40,
        display: 'flex', gap: 9,
        opacity: phase === 'hold' ? 1 : 0,
        transition: 'opacity 0.35s ease',
      }}>
        {[0, 1, 2].map(i => (
          <div key={i} style={{
            width: 8, height: 8, borderRadius: '50%',
            background: '#8B0000',
            animation: phase === 'hold' ? `dotPulse 1.1s ease-in-out ${i * 0.18}s infinite` : 'none',
          }} />
        ))}
      </div>
      <style>{`
        @keyframes dotPulse {
          0%, 100% { opacity: 0.2; transform: scale(0.8); }
          50% { opacity: 1; transform: scale(1.25); }
        }
      `}</style>
    </div>
  );
}

function App() {
  const [batches, setBatches] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showSplash, setShowSplash] = useState(true);
  const [view, setView] = useState('batches');
  const [selectedBatch, setSelectedBatch] = useState(null);
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [selectedExam, setSelectedExam] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [modalType, setModalType] = useState('');
  const [editingStudent, setEditingStudent] = useState(null);
  const [newName, setNewName] = useState('');
  const [newExamName, setNewExamName] = useState('');
  const [newScore, setNewScore] = useState('');
  const [newTotalScore, setNewTotalScore] = useState('');
  const [newStudentPhoto, setNewStudentPhoto] = useState(null);
  const [newStudentStatus, setNewStudentStatus] = useState('Regular');
  const [newCompanyName, setNewCompanyName] = useState('');
  const [saving, setSaving] = useState(false);
  const [printQRs, setPrintQRs] = useState(null);
  const [pendingDeepLink, setPendingDeepLink] = useState(null);
  const [showScanner, setShowScanner] = useState(false);
  const [scanningExamId, setScanningExamId] = useState(null);
  const [imageViewer, setImageViewer] = useState(null); // { images, index }
  const [resolvedImages, setResolvedImages] = useState({}); // imageId -> base64
  const imageCache = useRef({}); // in-memory cache
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [evaluations, setEvaluations] = useState([]); // per-student evaluations
  const [selectedEvaluation, setSelectedEvaluation] = useState(null);
  const [evalTitle, setEvalTitle] = useState('');
  const [evalDate, setEvalDate] = useState('');
  const [evalFields, setEvalFields] = useState({});
  const [evalSaving, setEvalSaving] = useState(false);
  const [remarksTranslation, setRemarksTranslation] = useState('');
  const [translating, setTranslating] = useState(false);
  const translateTimerRef = useRef(null);
  const [allTeachers, setAllTeachers] = useState([]);
  const [pullRefreshing, setPullRefreshing] = useState(false);
  const [pullDistance, setPullDistance] = useState(0);
  const pullStartY = useRef(null);
  const PULL_THRESHOLD = 110;
  const [isLoggedIn, setIsLoggedIn] = useState(() => localStorage.getItem(AUTH_KEY) === 'true');
  const [isViewer, setIsViewer] = useState(() => localStorage.getItem(ROLE_KEY) === 'viewer');
  const [isStudentView, setIsStudentView] = useState(false);
  const [qrPasswordPrompt, setQrPasswordPrompt] = useState(null); // { batchId, studentId } — pending QR scan awaiting password
  const [qrPassInput, setQrPassInput] = useState('');
  const [qrPassError, setQrPassError] = useState('');
  const [selectedTeacher, setSelectedTeacher] = useState(() => {
    const s = localStorage.getItem(TEACHER_KEY);
    return s ? JSON.parse(s) : null;
  });

  const fileInputRef = useRef(null);
  const studentPhotoInputRef = useRef(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const batchId = params.get('batch');
    const studentId = params.get('student');
    const isPhgicScan = params.get('phgic') === '1';
    if (batchId && studentId) {
      if (isPhgicScan) {
        // QR scan — require password before granting access
        const alreadyAuthed = localStorage.getItem(AUTH_KEY) === 'true' && localStorage.getItem(ROLE_KEY) === 'viewer';
        if (alreadyAuthed) {
          // Already verified this session, let them in
          setIsLoggedIn(true);
          setIsViewer(true);
          setPendingDeepLink({ batchId, studentId });
          fetchBatches(null);
        } else {
          // Show password prompt, store pending link
          setQrPasswordPrompt({ batchId, studentId });
        }
      } else {
        // Admin QR — require login first, then deeplink navigates after auth
        const alreadyLoggedIn = localStorage.getItem(AUTH_KEY) === 'true';
        setPendingDeepLink({ batchId, studentId });
        if (alreadyLoggedIn) {
          setIsLoggedIn(true);
          const role = localStorage.getItem(ROLE_KEY);
          const teacher = localStorage.getItem(TEACHER_KEY);
          setIsViewer(role === 'viewer');
          if (role === 'viewer') {
            fetchBatches(null);
          } else if (teacher) {
            fetchBatches(JSON.parse(teacher)._id);
          } else {
            fetchBatches(null);
          }
        }
        // If not logged in, LoginScreen will show — after login pendingDeepLink will auto-navigate
      }
    } else {
      const isAuth = localStorage.getItem(AUTH_KEY) === 'true';
      const role = localStorage.getItem(ROLE_KEY);
      if (isAuth && role === 'viewer') {
        fetchBatches(null);
      } else {
        const saved = localStorage.getItem(TEACHER_KEY);
        const teacher = saved ? JSON.parse(saved) : null;
        if (isAuth && teacher) {
          fetchBatches(teacher._id);
        }
      }
    }
  }, []);

  const fetchBatches = async (teacherId) => {
    try {
      setLoading(true);
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);
      const url = teacherId ? `${API}/batches?teacherId=${teacherId}` : `${API}/batches`;
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);
      const data = await res.json();
      setBatches(data);
      // Fetch all teachers to resolve signatures
      try {
        const tRes = await fetch(`${API}/teachers/with-signatures`);
        const tData = await tRes.json();
        setAllTeachers(tData);
      } catch {}
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
    setView('categories');
    setPendingDeepLink(null);
  }, [pendingDeepLink, batches]);

  const updateBatchInState = (updatedBatch) => {
    setBatches(prev => prev.map(b => b._id === updatedBatch._id ? updatedBatch : b));
    if (selectedBatch?._id === updatedBatch._id) setSelectedBatch(updatedBatch);
  };

  const goToStudents = (batch) => { setSelectedBatch(batch); setView('students'); };
  const goToCategories = (student) => {
    // Always resolve the freshest student from selectedBatch so categories/exams are current
    const freshStudent = selectedBatch?.students.find(s => s._id === student._id) || student;
    setSelectedStudent(freshStudent);
    setView('categories');
  };
  const goToExamItems = (cat) => { setSelectedCategory(cat); setView('examItems'); };
  const goToExamDetail = (exam) => { setSelectedExam(exam); setView('examDetail'); resolveExamImages(exam); };
  const goToEvaluations = () => { fetchEvaluations(); setView('evaluations'); };
  const goToEvaluationDetail = (ev) => {
    setSelectedEvaluation(ev);
    setEvalFields(ev.fields || {});
    setView('evaluationDetail');
  };

  const fetchEvaluations = async () => {
    try {
      const res = await fetch(`${API}/batches/${selectedBatch._id}/students/${selectedStudent._id}/evaluations`);
      const data = await res.json();
      setEvaluations(data);
    } catch { setEvaluations([]); }
  };

  const goBack = () => {
    if (view === 'examDetail') { setView('examItems'); setSelectedExam(null); }
    else if (view === 'examItems') { setView('categories'); setSelectedCategory(null); }
    else if (view === 'evaluationDetail') { setView('evaluations'); setSelectedEvaluation(null); }
    else if (view === 'evaluations') { setView('categories'); }
    else if (view === 'categories') { setView('students'); setSelectedStudent(null); }
    else if (view === 'students') { setView('batches'); setSelectedBatch(null); }
  };

  const openModal = (type) => {
    setModalType(type); setShowModal(true);
    setNewName(''); setNewExamName(''); setNewScore(''); setNewTotalScore(''); setNewStudentPhoto(null); setNewCompanyName('');
  };
  const openEditStudent = (student, e) => {
    e.stopPropagation();
    setEditingStudent(student);
    setNewName(student.name);
    setNewStudentStatus(student.status || 'Regular');
    setNewStudentPhoto(student.photo || null);
    setNewCompanyName(student.companyName || '');
    setModalType('editStudent');
    setShowModal(true);
  };
  const closeModal = () => {
    setShowModal(false);
    setEditingStudent(null);
    setNewName(''); setNewExamName(''); setNewScore(''); setNewTotalScore(''); setNewStudentPhoto(null); setNewStudentStatus('Regular'); setNewCompanyName('');
  };

  const updateStudent = async () => {
    if (!newName || !editingStudent) return;
    setSaving(true);
    try {
      const res = await fetch(`${API}/batches/${selectedBatch._id}/students/${editingStudent._id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName, photo: newStudentPhoto, status: newStudentStatus, companyName: newCompanyName })
      });
      const updatedBatch = await res.json();
      updateBatchInState(updatedBatch);
      closeModal();
    } catch { alert('Error updating student.'); }
    setSaving(false);
  };

  const saveBatch = async () => {
    if (!newName) return;
    setSaving(true);
    try {
      const res = await fetch(`${API}/batches`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName, teacherId: selectedTeacher?._id || null })
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
        body: JSON.stringify({ name: newName, photo: newStudentPhoto, status: newStudentStatus, companyName: newCompanyName })
      });
      const updatedBatch = await res.json();
      updateBatchInState(updatedBatch);
      closeModal();
    } catch { alert('Error saving student.'); }
    setSaving(false);
  };

  const saveCategory = async () => {
    if (!newName || !selectedStudent) return;
    setSaving(true);
    try {
      const res = await fetch(`${API}/batches/${selectedBatch._id}/students/${selectedStudent._id}/categories`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName })
      });
      const updatedBatch = await res.json();
      updateBatchInState(updatedBatch);
      const updatedStudent = updatedBatch.students.find(s => s._id === selectedStudent._id);
      if (updatedStudent) setSelectedStudent(updatedStudent);
      closeModal();
    } catch { alert('Error saving category.'); }
    setSaving(false);
  };

  const saveExamItem = async () => {
    if (!newExamName || !newScore || !newTotalScore || !selectedCategory) return;
    setSaving(true);
    try {
      const res = await fetch(`${API}/batches/${selectedBatch._id}/students/${selectedStudent._id}/categories/${selectedCategory._id}/items`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newExamName, score: parseInt(newScore), totalScore: parseInt(newTotalScore) })
      });
      const newItem = await res.json();
      // Update state locally — no need to reload the whole batch
      const updatedCat = { ...selectedCategory, items: [...(selectedCategory.items || []), newItem] };
      const updatedStudent = {
        ...selectedStudent,
        categories: selectedStudent.categories.map(c => c._id === selectedCategory._id ? updatedCat : c)
      };
      const updatedBatch = {
        ...selectedBatch,
        students: selectedBatch.students.map(s => s._id === selectedStudent._id ? updatedStudent : s)
      };
      setSelectedCategory(updatedCat);
      setSelectedStudent(updatedStudent);
      setSelectedBatch(updatedBatch);
      setBatches(prev => prev.map(b => b._id === updatedBatch._id ? updatedBatch : b));
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

  const toggleStudentStatus = async (student, e) => {
    e.stopPropagation();
    const newStatus = student.status === 'Selected' ? 'Regular' : 'Selected';
    try {
      const res = await fetch(`${API}/batches/${selectedBatch._id}/students/${student._id}/status`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus })
      });
      const updatedBatch = await res.json();
      updateBatchInState(updatedBatch);
    } catch { alert('Error updating status.'); }
  };

  const deleteCategory = async (catId, e) => {
    if (e) e.stopPropagation();
    if (!window.confirm('Delete this category and all its exams?')) return;
    try {
      const res = await fetch(`${API}/batches/${selectedBatch._id}/students/${selectedStudent._id}/categories/${catId}`, { method: 'DELETE' });
      const updatedBatch = await res.json();
      updateBatchInState(updatedBatch);
      const updatedStudent = updatedBatch.students.find(s => s._id === selectedStudent._id);
      if (updatedStudent) setSelectedStudent(updatedStudent);
    } catch { alert('Error deleting category.'); }
  };

  const deleteExamItem = async (itemId, e) => {
    if (e) e.stopPropagation();
    if (!window.confirm('Delete this exam?')) return;
    try {
      await fetch(`${API}/batches/${selectedBatch._id}/students/${selectedStudent._id}/categories/${selectedCategory._id}/items/${itemId}`, { method: 'DELETE' });
      const updatedCat = { ...selectedCategory, items: selectedCategory.items.filter(i => i._id !== itemId) };
      const updatedStudent = {
        ...selectedStudent,
        categories: selectedStudent.categories.map(c => c._id === selectedCategory._id ? updatedCat : c)
      };
      const updatedBatch = {
        ...selectedBatch,
        students: selectedBatch.students.map(s => s._id === selectedStudent._id ? updatedStudent : s)
      };
      setSelectedCategory(updatedCat);
      setSelectedStudent(updatedStudent);
      setSelectedBatch(updatedBatch);
      setBatches(prev => prev.map(b => b._id === updatedBatch._id ? updatedBatch : b));
      if (view === 'examDetail') { setView('examItems'); setSelectedExam(null); }
    } catch { alert('Error deleting exam.'); }
  };

  const deleteExam = deleteExamItem;

  const createEvaluation = async () => {
    if (!evalTitle || !evalDate) return;
    setSaving(true);
    try {
      const ordinals = ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th', '10th'];
      const num = evaluations.length;
      const ordinal = ordinals[num] || `${num + 1}th`;
      const res = await fetch(`${API}/batches/${selectedBatch._id}/students/${selectedStudent._id}/evaluations`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: evalTitle, ordinal, date: evalDate })
      });
      const newEval = await res.json();
      setEvaluations(prev => [...prev, newEval]);
      setEvalTitle(''); setEvalDate('');
      closeModal();
    } catch { alert('Error creating evaluation.'); }
    setSaving(false);
  };

  const deleteEvaluation = async (evalId, e) => {
    e.stopPropagation();
    if (!window.confirm('Delete this evaluation?')) return;
    try {
      await fetch(`${API}/batches/${selectedBatch._id}/students/${selectedStudent._id}/evaluations/${evalId}`, { method: 'DELETE' });
      setEvaluations(prev => prev.filter(ev => ev._id !== evalId));
    } catch { alert('Error deleting evaluation.'); }
  };

  const saveEvaluationFields = async () => {
    setEvalSaving(true);
    try {
      const res = await fetch(`${API}/batches/${selectedBatch._id}/students/${selectedStudent._id}/evaluations/${selectedEvaluation._id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: evalFields })
      });
      const updated = await res.json();
      setSelectedEvaluation(updated);
      setEvaluations(prev => prev.map(ev => ev._id === updated._id ? updated : ev));
      alert('Saved!');
    } catch { alert('Error saving evaluation.'); }
    setEvalSaving(false);
  };

  const deleteImagePage = async (examId, index) => {
    if (!window.confirm(`Delete page ${index + 1}?`)) return;
    try {
      await fetch(`${API}/batches/${selectedBatch._id}/students/${selectedStudent._id}/categories/${selectedCategory._id}/items/${examId}/remove-image`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ index })
      });
      // Update state locally
      const updatedExam = { ...selectedExam, images: selectedExam.images.filter((_, i) => i !== index) };
      const updatedCat = { ...selectedCategory, items: selectedCategory.items.map(it => it._id === examId ? updatedExam : it) };
      const updatedStudent = { ...selectedStudent, categories: selectedStudent.categories.map(c => c._id === selectedCategory._id ? updatedCat : c) };
      const updatedBatch = { ...selectedBatch, students: selectedBatch.students.map(s => s._id === selectedStudent._id ? updatedStudent : s) };
      setSelectedExam(updatedExam);
      setSelectedCategory(updatedCat);
      setSelectedStudent(updatedStudent);
      setSelectedBatch(updatedBatch);
      setBatches(prev => prev.map(b => b._id === updatedBatch._id ? updatedBatch : b));
    } catch { alert('Error deleting page.'); }
  };

  const uploadImage = async (examId, imageData) => {
    try {
      // Step 1: Upload image to Cloudinary via server, get ID + URL back
      const imgRes = await fetch(`${API}/images`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: imageData })
      });
      const { _id: imageId, url: imageUrl } = await imgRes.json();

      // Step 2: Store imageId reference in batch item
      const res = await fetch(`${API}/batches/${selectedBatch._id}/students/${selectedStudent._id}/categories/${selectedCategory._id}/items/${examId}/image`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: imageId })
      });
      const data = await res.json();
      if (!data.success) throw new Error('Upload failed');

      // Cache the Cloudinary URL locally so display is instant
      const imgSrc = imageUrl || imageData;
      imageCache.current[imageId] = imgSrc;
      setResolvedImages(prev => ({ ...prev, [imageId]: imgSrc }));

      // Update state locally
      const updatedExam = { ...selectedExam, images: [...(selectedExam?.images || []), imageId] };
      const updatedCat = { ...selectedCategory, items: selectedCategory.items.map(it => it._id === examId ? updatedExam : it) };
      const updatedStudent = { ...selectedStudent, categories: selectedStudent.categories.map(c => c._id === selectedCategory._id ? updatedCat : c) };
      const updatedBatch = { ...selectedBatch, students: selectedBatch.students.map(s => s._id === selectedStudent._id ? updatedStudent : s) };
      setSelectedExam(updatedExam);
      setSelectedCategory(updatedCat);
      setSelectedStudent(updatedStudent);
      setSelectedBatch(updatedBatch);
      setBatches(prev => prev.map(b => b._id === updatedBatch._id ? updatedBatch : b));
    } catch { alert('Error saving image.'); }
  };

  // Resolve image IDs to displayable src — Cloudinary URL or legacy base64
  const resolveImage = async (idOrData) => {
    if (!idOrData) return null;
    // Legacy: already base64
    if (idOrData.startsWith('data:')) return idOrData;
    // Already a Cloudinary URL
    if (idOrData.startsWith('http')) return idOrData;
    // Check cache
    if (imageCache.current[idOrData]) return imageCache.current[idOrData];
    try {
      const res = await fetch(`${API}/images/${idOrData}`);
      const data = await res.json();
      // data.url is Cloudinary URL
      const src = data.url || data.data || null;
      if (src) {
        imageCache.current[idOrData] = src;
        setResolvedImages(prev => ({ ...prev, [idOrData]: src }));
      }
      return src;
    } catch { return null; }
  };

  // Resolve all images for current exam when exam detail is shown
  const resolveExamImages = async (exam) => {
    if (!exam?.images?.length) return;
    for (const idOrData of exam.images) {
      if (!idOrData.startsWith('data:') && !idOrData.startsWith('http') && !imageCache.current[idOrData]) {
        await resolveImage(idOrData);
      }
    }
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
    const studentsToGenerate = isViewer
      ? selectedBatch.students.filter(s => s.status === 'Selected')
      : selectedBatch.students;
    const results = await Promise.all(
      studentsToGenerate.map(async (student) => {
        const url = `${window.location.origin}${window.location.pathname}?phgic=1&batch=${selectedBatch._id}&student=${student._id}`;
        const dataUrl = await QRCode.toDataURL(url, { width: 400, margin: 2 });
        return { name: student.name, photo: student.photo, dataUrl };
      })
    );
    setPrintQRs(results);
  };

  if (showSplash) return (
    <SplashScreen onDone={() => setShowSplash(false)} />
  );

  if (loading) return (
    <div style={{ minHeight: '100vh', background: '#f2f2f7', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ display: 'flex', gap: 9 }}>
        {[0,1,2].map(i => (
          <div key={i} style={{ width: 8, height: 8, borderRadius: '50%', background: '#8B0000', animation: `dotPulse 1.1s ease-in-out ${i*0.18}s infinite` }} />
        ))}
      </div>
      <style>{`@keyframes dotPulse { 0%,100%{opacity:.2;transform:scale(.8)} 50%{opacity:1;transform:scale(1.25)} }`}</style>
    </div>
  );

  // QR scan password prompt — show before anything else if pending
  if (qrPasswordPrompt) return (
    <div style={{ minHeight: '100vh', background: '#f2f2f7', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '32px 24px' }}>
      <div style={{ fontSize: 56, marginBottom: 16 }}>🔒</div>
      <h2 style={{ fontSize: 22, fontWeight: 700, color: '#1c1c1e', marginBottom: 6, textAlign: 'center' }}>Access Required</h2>
      <p style={{ fontSize: 14, color: '#8e8e93', marginBottom: 28, textAlign: 'center' }}>Enter the password to view this student's record.</p>
      <div style={{ width: '100%', maxWidth: 340, background: '#fff', borderRadius: 16, padding: '20px', boxShadow: '0 2px 16px rgba(0,0,0,0.08)' }}>
        <input
          type="password"
          value={qrPassInput}
          onChange={e => { setQrPassInput(e.target.value); setQrPassError(''); }}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              if (qrPassInput === PHGIC_PASS) {
                localStorage.setItem(AUTH_KEY, 'true');
                localStorage.setItem(ROLE_KEY, 'viewer');
                setIsLoggedIn(true);
                setIsViewer(true);
                setPendingDeepLink(qrPasswordPrompt);
                setQrPasswordPrompt(null);
                setQrPassInput('');
                fetchBatches(null);
              } else {
                setQrPassError('Incorrect password. Please try again.');
              }
            }
          }}
          placeholder="Enter password"
          autoFocus
          style={{ width: '100%', padding: '12px 14px', borderRadius: 10, border: `1.5px solid ${qrPassError ? '#ff3b30' : '#e5e5ea'}`, fontSize: 16, boxSizing: 'border-box', marginBottom: 10, outline: 'none' }}
        />
        {qrPassError && <p style={{ color: '#ff3b30', fontSize: 13, margin: '0 0 10px', textAlign: 'center' }}>{qrPassError}</p>}
        <button
          onClick={() => {
            if (qrPassInput === PHGIC_PASS) {
              localStorage.setItem(AUTH_KEY, 'true');
              localStorage.setItem(ROLE_KEY, 'viewer');
              setIsLoggedIn(true);
              setIsViewer(true);
              setPendingDeepLink(qrPasswordPrompt);
              setQrPasswordPrompt(null);
              setQrPassInput('');
              fetchBatches(null);
            } else {
              setQrPassError('Incorrect password. Please try again.');
            }
          }}
          style={{ width: '100%', background: '#8B0000', color: '#fff', border: 'none', borderRadius: 10, padding: '13px', fontSize: 16, fontWeight: 700, cursor: 'pointer' }}>
          View Record
        </button>
      </div>
    </div>
  );

  // Always require login — no QR scan bypasses auth
  if (!isLoggedIn) return (
    <LoginScreen onLogin={(role) => {
      setIsLoggedIn(true);
      setIsViewer(role === 'viewer');
      if (role === 'viewer') fetchBatches(null);
      else {
        const teacher = localStorage.getItem(TEACHER_KEY);
        if (teacher) fetchBatches(JSON.parse(teacher)._id);
      }
    }} />
  );

  if (!isViewer && !selectedTeacher) return (
    <TeacherSelect onSelect={(t) => {
      localStorage.setItem(TEACHER_KEY, JSON.stringify(t));
      setSelectedTeacher(t);
      fetchBatches(t._id);
    }} />
  );

  const renderBatches = () => (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <div>
          <p style={{ fontSize: 13, color: '#8e8e93', margin: 0 }}>Logged in as</p>
          <h1 className="title" style={{ margin: '2px 0 0 0' }}>
            {isViewer ? 'PHGIC' : `${selectedTeacher?.emoji} ${selectedTeacher?.name}`}
          </h1>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {isViewer && <span style={{ background: '#fff3cd', color: '#856404', fontSize: 11, fontWeight: 700, padding: '4px 8px', borderRadius: 6, border: '1px solid #ffc107' }}>VIEW ONLY</span>}
          {!isViewer && (
            <button onClick={() => { localStorage.removeItem(TEACHER_KEY); setSelectedTeacher(null); setBatches([]); }}
              style={{ background: 'none', border: '1.5px solid #8B0000', borderRadius: 8, color: '#8B0000', fontSize: 13, fontWeight: 600, padding: '6px 12px', cursor: 'pointer' }}>
              Switch
            </button>
          )}
          <button onClick={() => { localStorage.removeItem(AUTH_KEY); localStorage.removeItem(ROLE_KEY); localStorage.removeItem(TEACHER_KEY); setIsLoggedIn(false); setIsViewer(false); setSelectedTeacher(null); setBatches([]); }}
            style={{ background: 'none', border: '1.5px solid #ff3b30', borderRadius: 8, color: '#ff3b30', fontSize: 13, fontWeight: 600, padding: '6px 12px', cursor: 'pointer' }}>
            Logout
          </button>
        </div>
      </div>
      <h2 style={{ fontSize: 16, fontWeight: 600, color: '#3a3a3c', margin: '16px 0 12px' }}>{isViewer ? 'All Batches' : 'My Batches'}</h2>
      {(isViewer ? batches.filter(b => b.students.some(s => s.status === 'Selected')) : batches).map(batch => (
        <div key={batch._id} className="card clickable" onClick={() => goToStudents(batch)}>
          <div className="card-content">
            <div>
              <h2 className="card-title">🎌 {batch.name}</h2>
              <p className="card-subtitle">
                {isViewer
                  ? `${batch.students.filter(s => s.status === 'Selected').length} selected student${batch.students.filter(s => s.status === 'Selected').length !== 1 ? 's' : ''}`
                  : `${batch.students.length} student${batch.students.length !== 1 ? 's' : ''}`}
              </p>
            </div>
            {!isViewer && <button className="delete-btn-icon" onClick={(e) => deleteBatch(batch._id, e)}>✕</button>}
          </div>
        </div>
      ))}
      {!isViewer && <button className="add-button" onClick={() => openModal('batch')}>+ Add New Batch</button>}
    </>
  );

  const renderStudents = () => (
    <>
      <button className="back-btn" onClick={goBack}>←</button>
      <div className="header-with-back">
        <h1 className="title">{selectedBatch.name}</h1>
      </div>
      <h2 className="section-title">Students</h2>
      {(isViewer ? selectedBatch.students.filter(s => s.status === 'Selected') : selectedBatch.students).map(student => (
        <div key={student._id} className="card student-card clickable" onClick={() => goToCategories(student)}>
          <div className="card-content">
            <div className="student-card-left">
              {student.photo
                ? <img src={student.photo} alt={student.name} className="student-avatar" />
                : <span className="student-avatar-icon">👤</span>
              }
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <h3 className="card-title" style={{ margin: 0 }}>{student.name}</h3>
                  <span
                    onClick={!isViewer ? (e) => toggleStudentStatus(student, e) : undefined}
                    style={{
                      background: student.status === 'Selected' ? '#007AFF' : '#e5e5ea',
                      color: student.status === 'Selected' ? '#fff' : '#6e6e73',
                      fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20,
                      cursor: isViewer ? 'default' : 'pointer'
                    }}>
                    {student.status === 'Selected' ? 'SELECTED' : 'REGULAR'}
                  </span>
                </div>
                <p className="card-subtitle">{student.categories?.length || 0} categor{student.categories?.length !== 1 ? "ies" : "y"}</p>
              </div>
            </div>
            {!isViewer && (
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="delete-btn-icon" style={{ background: '#e5f1ff', color: '#007AFF', border: 'none' }} onClick={(e) => openEditStudent(student, e)}>✎</button>
                <button className="delete-btn-icon" onClick={(e) => deleteStudent(student._id, e)}>✕</button>
              </div>
            )}
          </div>
        </div>
      ))}
      {!isViewer && <button className="add-button" onClick={() => openModal('student')}>+ Add Student</button>}
      {selectedBatch.students.length > 0 && (
        <button className="print-qr-button" onClick={generateBatchQRs}>🖨 Print QR Codes</button>
      )}
    </>
  );

  const renderCategories = () => (
    <>
      <button className="back-btn" onClick={goBack}>←</button>
      <div className="student-profile-header">
        {selectedStudent.photo
          ? <img src={selectedStudent.photo} alt={selectedStudent.name} className="student-profile-avatar" />
          : <span className="student-profile-icon">👤</span>
        }
        <h1 className="student-profile-name">{selectedStudent.name}</h1>
      </div>

      {/* ── Exam Categories Box ── */}
      <div style={{ background: '#fff', borderRadius: 16, border: '1.5px solid #e5e5ea', padding: '16px', marginBottom: 16, boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h2 style={{ fontSize: 15, fontWeight: 700, color: '#3a3a3c', margin: 0 }}>📁 Exam Categories</h2>
          {!isViewer && (
            <button onClick={() => openModal('category')} style={{ background: '#007AFF', color: '#fff', border: 'none', borderRadius: 8, fontSize: 12, fontWeight: 600, padding: '5px 12px', cursor: 'pointer' }}>+ Add</button>
          )}
        </div>
        {(selectedStudent.categories || []).length === 0
          ? <p style={{ fontSize: 13, color: '#8e8e93', margin: 0, textAlign: 'center', padding: '12px 0' }}>No exam categories yet.</p>
          : (selectedStudent.categories || []).map(cat => (
            <div key={cat._id} className="card exam-card clickable" style={{ margin: '0 0 8px 0' }} onClick={() => goToExamItems(cat)}>
              <div className="card-content">
                <div>
                  <h3 className="card-title">📁 {cat.name}</h3>
                  <p className="card-subtitle">{cat.items?.length || 0} exam{cat.items?.length !== 1 ? 's' : ''}</p>
                </div>
                <div className="exam-right">
                  {!isViewer && <button className="delete-btn-icon" onClick={(e) => deleteCategory(cat._id, e)}>✕</button>}
                </div>
              </div>
            </div>
          ))
        }
      </div>

      {/* ── Evaluations Box ── */}
      <div style={{ background: '#fff', borderRadius: 16, border: '1.5px solid #e5e5ea', padding: '16px', marginBottom: 16, boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h2 style={{ fontSize: 15, fontWeight: 700, color: '#3a3a3c', margin: 0 }}>📋 Evaluations</h2>
          {!isViewer && (
            <button onClick={() => { setEvalTitle(''); setEvalDate(new Date().toISOString().split('T')[0]); openModal('evaluation'); }} style={{ background: '#34C759', color: '#fff', border: 'none', borderRadius: 8, fontSize: 12, fontWeight: 600, padding: '5px 12px', cursor: 'pointer' }}>+ Add</button>
          )}
        </div>
        <button onClick={goToEvaluations} style={{ width: '100%', background: '#f2f2f7', border: 'none', borderRadius: 10, padding: '10px 14px', textAlign: 'left', fontSize: 14, color: '#3a3a3c', cursor: 'pointer', fontWeight: 500 }}>
          View all evaluations →
        </button>
      </div>
    </>
  );

  const renderEvaluations = () => (
    <>
      <button className="back-btn" onClick={goBack}>←</button>
      <div className="student-profile-header">
        {selectedStudent.photo
          ? <img src={selectedStudent.photo} alt={selectedStudent.name} className="student-profile-avatar" />
          : <span className="student-profile-icon">👤</span>
        }
        <h1 className="student-profile-name">{selectedStudent.name}</h1>
      </div>
      <h2 className="section-title">Evaluations</h2>
      {evaluations.length === 0
        ? <p style={{ fontSize: 14, color: '#8e8e93', textAlign: 'center', marginTop: 32 }}>No evaluations yet.</p>
        : evaluations.map(ev => (
          <div key={ev._id} className="card exam-card clickable" onClick={() => goToEvaluationDetail(ev)}>
            <div className="card-content">
              <div>
                <h3 className="card-title">📋 {ev.ordinal} Evaluation — {ev.title}</h3>
                <p className="card-subtitle">📅 {ev.date}</p>
              </div>
              {!isViewer && <button className="delete-btn-icon" onClick={(e) => deleteEvaluation(ev._id, e)}>✕</button>}
            </div>
          </div>
        ))
      }
      {!isViewer && (
        <button className="add-button" onClick={() => { setEvalTitle(''); setEvalDate(new Date().toISOString().split('T')[0]); openModal('evaluation'); }}>+ Add Evaluation</button>
      )}
    </>
  );

  const translateRemarks = (text) => {
    if (translateTimerRef.current) clearTimeout(translateTimerRef.current);
    if (!text.trim()) { setRemarksTranslation(''); return; }
    translateTimerRef.current = setTimeout(async () => {
      setTranslating(true);
      try {
        const res = await fetch(`${API}/translate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text })
        });
        const data = await res.json();
        console.log('[translate] response:', data);
        if (data.translation) {
          setRemarksTranslation(data.translation);
        } else {
          console.warn('[translate] empty translation, error:', data.error);
          setRemarksTranslation('');
        }
      } catch (err) {
        console.error('[translate] fetch error:', err);
        setRemarksTranslation('');
      }
      finally { setTranslating(false); }
    }, 900);
  };

  const renderEvaluationDetail = () => {
    const ratingField = (key, label, sublabel) => (
      <div style={{ marginBottom: 20 }}>
        <div style={{ marginBottom: 8 }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: '#3a3a3c' }}>{label}</span>
          {sublabel && <span style={{ fontSize: 12, color: '#8e8e93', marginLeft: 6 }}>{sublabel}</span>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', flex: 1 }}>
            {[...Array(11)].map((_, i) => (
              <button key={i} onClick={() => !isViewer && setEvalFields(f => ({ ...f, [key]: i }))}
                style={{
                  width: 36, height: 36, borderRadius: 8, border: 'none', cursor: isViewer ? 'default' : 'pointer',
                  fontWeight: 700, fontSize: 13,
                  background: evalFields[key] === i ? '#007AFF' : '#f2f2f7',
                  color: evalFields[key] === i ? '#fff' : '#3a3a3c',
                  transition: 'all 0.15s'
                }}>
                {i}
              </button>
            ))}
          </div>
          <span style={{ fontSize: 20, fontWeight: 800, color: '#007AFF', minWidth: 32, textAlign: 'right' }}>
            {evalFields[key] ?? '—'}
          </span>
        </div>
      </div>
    );

    const textField = (key, label, sublabel, placeholder) => {
      const isRemarks = key === 'remarks';
      const value = evalFields[key] || '';
      return (
        <div style={{ marginBottom: 16 }}>
          <div style={{ marginBottom: 6 }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: '#3a3a3c' }}>{label}</span>
            {sublabel && <span style={{ fontSize: 12, color: '#8e8e93', marginLeft: 6 }}>{sublabel}</span>}
          </div>
          {isRemarks ? (
            isViewer ? (
              <div style={{
                width: '100%', padding: '10px 12px', borderRadius: 10,
                border: '1.5px solid #e5e5ea', fontSize: 15, boxSizing: 'border-box',
                background: '#f9f9f9', color: '#3a3a3c', fontFamily: 'inherit',
                whiteSpace: 'pre-wrap', wordBreak: 'break-word', minHeight: 44,
                lineHeight: 1.5,
              }}>
                {value || <span style={{ color: '#c7c7cc' }}>{placeholder}</span>}
              </div>
            ) : (
              <div>
                <textarea
                  value={value}
                  onChange={(e) => {
                    setEvalFields(f => ({ ...f, [key]: e.target.value }));
                    e.target.style.height = 'auto';
                    e.target.style.height = e.target.scrollHeight + 'px';
                    translateRemarks(e.target.value);
                  }}
                  onInput={(e) => {
                    e.target.style.height = 'auto';
                    e.target.style.height = e.target.scrollHeight + 'px';
                  }}
                  placeholder={placeholder}
                  lang="ja"
                  rows={3}
                  style={{
                    width: '100%', padding: '10px 12px', borderRadius: 10,
                    border: '1.5px solid #e5e5ea', fontSize: 15, boxSizing: 'border-box',
                    background: '#fff', color: '#3a3a3c', fontFamily: 'inherit',
                    resize: 'none', overflow: 'hidden', lineHeight: 1.5,
                    minHeight: 80,
                  }}
                />
                {/* Translation preview */}
                {(translating || remarksTranslation) && (
                  <div style={{
                    marginTop: 8, padding: '10px 12px', borderRadius: 10,
                    background: '#f0f7ff', border: '1.5px solid #cce4ff',
                    fontSize: 14, lineHeight: 1.6, color: '#1a1a2e',
                    whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                  }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: '#007AFF', display: 'block', marginBottom: 4, letterSpacing: 0.5 }}>
                      🇯🇵 日本語訳 {translating && '…'}
                    </span>
                    {translating
                      ? <span style={{ color: '#8e8e93', fontStyle: 'italic' }}>Translating...</span>
                      : <span>{remarksTranslation}</span>
                    }
                    {!translating && remarksTranslation && (
                      <button
                        onClick={() => {
                          setEvalFields(f => ({ ...f, [key]: remarksTranslation }));
                          setRemarksTranslation('');
                        }}
                        style={{
                          display: 'block', marginTop: 8, background: '#007AFF',
                          color: '#fff', border: 'none', borderRadius: 8,
                          padding: '6px 14px', fontSize: 13, fontWeight: 700,
                          cursor: 'pointer',
                        }}>
                        ✓ Use Japanese
                      </button>
                    )}
                  </div>
                )}
              </div>
            )
          ) : (
            <input
              type="text"
              value={value}
              onChange={(e) => !isViewer && setEvalFields(f => ({ ...f, [key]: e.target.value }))}
              readOnly={isViewer}
              placeholder={placeholder}
              lang="ja"
              style={{
                width: '100%', padding: '10px 12px', borderRadius: 10,
                border: '1.5px solid #e5e5ea', fontSize: 15, boxSizing: 'border-box',
                background: isViewer ? '#f9f9f9' : '#fff', color: '#3a3a3c',
                fontFamily: 'inherit'
              }}
            />
          )}
        </div>
      );
    };

    return (
      <>
        <button className="back-btn" onClick={goBack}>←</button>
        <div className="header-with-back">
          <h1 className="title">📋 {selectedEvaluation?.ordinal} Evaluation</h1>
        </div>

        {/* Header info */}
        <div style={{ background: '#fff', borderRadius: 16, border: '1.5px solid #e5e5ea', padding: '14px 16px', marginBottom: 20, boxShadow: '0 2px 8px rgba(0,0,0,0.06)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <p style={{ margin: '0 0 4px', fontSize: 15, fontWeight: 700, color: '#3a3a3c' }}>{selectedEvaluation?.title}</p>
            <p style={{ margin: 0, fontSize: 13, color: '#8e8e93' }}>📅 {selectedEvaluation?.date}</p>
          </div>
          <div style={{ textAlign: 'right' }}>
            <p style={{ margin: 0, fontSize: 12, color: '#8e8e93' }}>Student</p>
            <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: '#3a3a3c' }}>{selectedStudent?.name}</p>
          </div>
        </div>

        {/* Company Name */}
        {selectedStudent?.companyName && (
          <div style={{ background: '#fff', borderRadius: 16, border: '1.5px solid #e5e5ea', padding: '14px 16px', marginBottom: 16, boxShadow: '0 2px 8px rgba(0,0,0,0.06)', display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 20 }}>🏢</span>
            <div>
              <p style={{ margin: 0, fontSize: 11, color: '#8e8e93', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>Company</p>
              <p style={{ margin: 0, fontSize: 15, fontWeight: 700, color: '#3a3a3c' }}>{selectedStudent.companyName}</p>
            </div>
          </div>
        )}

        {/* Ratings Section */}
        <div style={{ background: '#fff', borderRadius: 16, border: '1.5px solid #e5e5ea', padding: '16px', marginBottom: 16, boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
          <h3 style={{ fontSize: 13, fontWeight: 700, color: '#8e8e93', textTransform: 'uppercase', letterSpacing: 0.5, margin: '0 0 16px' }}>Skills Rating (0–10)</h3>
          {ratingField('reading', 'READING', '読むこと')}
          {ratingField('listening', 'LISTENING', '聞くこと')}
          {ratingField('speaking', 'SPEAKING', '話すこと')}
        </div>

        {/* Text Fields Section */}
        <div style={{ background: '#fff', borderRadius: 16, border: '1.5px solid #e5e5ea', padding: '16px', marginBottom: 16, boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
          <h3 style={{ fontSize: 13, fontWeight: 700, color: '#8e8e93', textTransform: 'uppercase', letterSpacing: 0.5, margin: '0 0 16px' }}>Details</h3>
          {textField('from', 'FROM', null, 'e.g., Lesson 1')}
          {textField('to', 'TO', null, 'e.g., Lesson 10')}
          {textField('currentLesson', 'CURRENT LESSON', null, 'e.g., Chapter 3 - Greetings')}
          {textField('remarks', 'REMARKS', '備考', 'コメントを入力してください...')}
        </div>

        {/* Teacher Signature */}
        {(() => {
          const batchTeacherId = selectedBatch?.teacherId;
          const teacher = allTeachers.find(t => t._id === batchTeacherId);
          if (!teacher?.signature) return null;
          return (
            <div style={{ background: '#fff', borderRadius: 16, border: '1.5px solid #e5e5ea', padding: '16px', marginBottom: 16, boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
              <h3 style={{ fontSize: 13, fontWeight: 700, color: '#8e8e93', textTransform: 'uppercase', letterSpacing: 0.5, margin: '0 0 12px' }}>Teacher's Signature</h3>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <img
                  src={teacher.signature}
                  alt={`${teacher.name} signature`}
                  style={{ height: 72, maxWidth: 200, objectFit: 'contain', borderRadius: 8, border: '1px solid #e5e5ea', background: '#fafafa', padding: 4 }}
                />
                <div>
                  <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: '#3a3a3c' }}>{teacher.name}</p>
                  <p style={{ margin: '2px 0 0', fontSize: 12, color: '#8e8e93' }}>Class Teacher</p>
                </div>
              </div>
            </div>
          );
        })()}

        {!isViewer && (
          <button onClick={saveEvaluationFields} disabled={evalSaving}
            style={{ width: '100%', background: '#007AFF', color: '#fff', border: 'none', borderRadius: 12, padding: '14px', fontSize: 16, fontWeight: 700, cursor: evalSaving ? 'not-allowed' : 'pointer', marginBottom: 24, opacity: evalSaving ? 0.7 : 1 }}>
            {evalSaving ? 'Saving...' : '💾 Save Evaluation'}
          </button>
        )}
      </>
    );
  };

  const renderExamItems = () => (
    <>
      <button className="back-btn" onClick={goBack}>←</button>
      <div className="header-with-back">
        <h1 className="title">📁 {selectedCategory?.name}</h1>
      </div>
      <h2 className="section-title">Exams</h2>
      {(selectedCategory?.items || []).map(item => (
        <div key={item._id} className="card exam-card clickable" onClick={() => goToExamDetail(item)}>
          <div className="card-content">
            <div>
              <h3 className="card-title">📝 {item.name}</h3>
              <p className="card-subtitle">{item.date} • Score: {item.score}/{item.totalScore ?? 100}</p>
            </div>
            <div className="exam-right">
              {item.images?.length > 0 && <span className="has-photo-badge">📷</span>}
              {!isViewer && <button className="delete-btn-icon" onClick={(e) => deleteExamItem(item._id, e)}>✕</button>}
            </div>
          </div>
        </div>
      ))}
      {!isViewer && <button className="add-button" onClick={() => openModal('exam')}>+ Add Exam</button>}
    </>
  );

  const renderExamDetail = () => {
    const rawImages = selectedExam.images?.length > 0
      ? selectedExam.images
      : selectedExam.image ? [selectedExam.image] : [];
    // Resolve IDs to URLs — legacy base64 and Cloudinary URLs pass through
    const allImages = rawImages.map(idOrData =>
      (idOrData.startsWith('data:') || idOrData.startsWith('http')) ? idOrData : (resolvedImages[idOrData] || null)
    );

    return (
      <>
        <button className="back-btn" onClick={goBack}>←</button>
        <div className="header-with-back">
          <h1 className="title">{selectedExam.name}</h1>
        </div>
        <div className="exam-detail-info">
          <span className="detail-badge">📅 {selectedExam.date}</span>
          <span className="detail-badge">🎯 Score: {selectedExam.score}/{selectedExam.totalScore ?? 100}</span>
        </div>

        <h2 className="section-title">Exam Pages ({allImages.length} pages)</h2>

        {/* Action buttons — hidden for viewer */}
        {!isViewer && (
          <div style={{ display: 'flex', gap: 10, marginBottom: 16, padding: '0 4px' }}>
            <button className="save-btn" style={{ flex: 1 }} onClick={() => openScanner(selectedExam._id)}>
              📷 Scan Page
            </button>
            <button className="cancel-btn" style={{ flex: 1 }} onClick={() => triggerFileInput(selectedExam._id)}>
              🖼️ Upload Page
            </button>
          </div>
        )}

        {/* Document pages — vertical list like Files app */}
        {rawImages.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '32px 0' }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>📄</div>
            <p style={{ color: '#8E8E93' }}>No pages yet. Scan or upload to add.</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '0 4px' }}>
            {rawImages.map((idOrData, idx) => {
              const src = (idOrData.startsWith('data:') || idOrData.startsWith('http')) ? idOrData : resolvedImages[idOrData];
              return (
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
                  {!isViewer && (
                    <button
                      onClick={(e) => { e.stopPropagation(); deleteImagePage(selectedExam._id, idx); }}
                      style={{
                        background: 'none', border: 'none', color: '#ff3b30',
                        fontSize: 13, fontWeight: 600, cursor: 'pointer', padding: '2px 6px'
                      }}
                    >
                      🗑 Delete
                    </button>
                  )}
                </div>
                {/* Document image or loading placeholder */}
                {src ? (
                <img
                  src={src}
                  alt={`Page ${idx + 1}`}
                  onClick={() => setImageViewer({ images: allImages.filter(Boolean), index: allImages.filter(Boolean).indexOf(src) })}
                  style={{
                    width: '100%',
                    aspectRatio: '210 / 297',
                    objectFit: 'contain',
                    display: 'block',
                    background: '#fafafa',
                    cursor: 'zoom-in'
                  }}
                />
                ) : (
                  <div style={{ width: '100%', aspectRatio: '210/297', background: '#f5f5f7', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <span style={{ color: '#8e8e93', fontSize: 13 }}>⏳ Loading...</span>
                  </div>
                )}
              </div>
              );
            })}
          </div>
        )}

        {/* Spacer before delete button */}
        <div style={{ height: 16 }} />

        {/* Hidden — keep old empty state removed */}
        {false && (
          <div></div>
        )}

        {!isViewer && <button className="delete-button-full" onClick={(e) => deleteExam(selectedExam._id, e)}>
          🗑 Delete Exam
        </button>}

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
    const titles = { batch: 'Add New Batch', student: 'Add New Student', editStudent: 'Edit Student', category: 'Add Exam Category', exam: 'Add New Exam', evaluation: 'New Evaluation' };
    return (
      <div className="modal-overlay">
        <div className="modal">
          <h2 className="modal-title">{titles[modalType]}</h2>
          {modalType === 'evaluation' ? (
            <>
              <div className="form-group">
                <label>Evaluation Title:</label>
                <input type="text" value={evalTitle} onChange={(e) => setEvalTitle(e.target.value)} placeholder="e.g., Mid-term, Final, Progress Check" />
              </div>
              <div className="form-group">
                <label>Date:</label>
                <input type="date" value={evalDate} onChange={(e) => setEvalDate(e.target.value)} style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1.5px solid #e5e5ea', fontSize: 15 }} />
              </div>
              <p style={{ fontSize: 12, color: '#8e8e93', margin: '4px 0 0' }}>
                This will be saved as the <strong>{['1st','2nd','3rd','4th','5th','6th','7th','8th','9th','10th'][evaluations.length] || `${evaluations.length+1}th`} Evaluation</strong>.
              </p>
            </>
          ) : modalType === 'category' ? (
            <div className="form-group">
              <label>Category Name:</label>
              <input type="text" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g., Kanji, Grammar, Vocabulary" />
            </div>
          ) : modalType === 'exam' ? (
            <>
              <div className="form-group">
                <label>Exam Name:</label>
                <input type="text" value={newExamName} onChange={(e) => setNewExamName(e.target.value)} placeholder="e.g., Quiz 1, Midterm, Finals" />
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <div className="form-group" style={{ flex: 1 }}>
                  <label>Score:</label>
                  <input type="number" value={newScore} onChange={(e) => setNewScore(e.target.value)} placeholder="e.g., 85" min="0" />
                </div>
                <div className="form-group" style={{ flex: 1 }}>
                  <label>Total Score:</label>
                  <input type="number" value={newTotalScore} onChange={(e) => setNewTotalScore(e.target.value)} placeholder="e.g., 100" min="1" />
                </div>
              </div>
            </>
          ) : modalType === 'student' || modalType === 'editStudent' ? (
            <>
              <div className="form-group">
                <label>Name:</label>
                <input type="text" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g., Juan Cruz" />
              </div>
              <div className="form-group">
                <label>Status:</label>
                <select value={newStudentStatus} onChange={(e) => setNewStudentStatus(e.target.value)}
                  style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1.5px solid #e5e5ea', fontSize: 15, background: '#fff' }}>
                  <option value="Regular">Regular</option>
                  <option value="Selected">Selected</option>
                </select>
              </div>
              {newStudentStatus === 'Selected' && (
                <div className="form-group">
                  <label>Company Name:</label>
                  <input type="text" value={newCompanyName} onChange={(e) => setNewCompanyName(e.target.value)} placeholder="e.g., Toyota, Nissan..." />
                </div>
              )}
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
              onClick={modalType === 'evaluation' ? createEvaluation : modalType === 'batch' ? saveBatch : modalType === 'editStudent' ? updateStudent : modalType === 'student' ? saveStudent : modalType === 'category' ? saveCategory : saveExamItem}>
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    );
  };

  const handlePrint = (mode) => {
    // mode: 'portrait' = 6/page (2col x 3row), 'landscape' = 10/page (5col x 2row)
    const isLandscape = mode === 'landscape';
    const perPage = isLandscape ? 10 : 6;
    const cols = isLandscape ? 5 : 2;

    // Group cards into pages
    const pages = [];
    for (let i = 0; i < printQRs.length; i += perPage) {
      pages.push(printQRs.slice(i, i + perPage));
    }

    const cardSize   = isLandscape ? { avatar: '13mm', qr: '25mm', name: '6.5pt', batch: '5.5pt', pad: '3mm 2mm', gap: '3mm' }
                                   : { avatar: '18mm', qr: '34mm', name: '8pt',   batch: '7pt',   pad: '5mm 3mm', gap: '5mm' };

    const pagesHtml = pages.map((page, pi) => {
      const cards = page.map(item => `
        <div class="qr-card">
          ${item.photo
            ? `<img src="${item.photo}" class="avatar" />`
            : `<div class="avatar-placeholder">👤</div>`}
          <img src="${item.dataUrl}" class="qr" />
          <p class="name">${item.name}</p>
          <p class="batch">${selectedBatch.name}</p>
        </div>
      `).join('');
      const isLast = pi === pages.length - 1;
      return `<div class="page${isLast ? '' : ' page-break'}">${cards}</div>`;
    }).join('');

    const win = window.open('', '_blank', 'width=900,height=700');
    win.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>QR Codes — ${selectedBatch.name}</title>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { font-family: sans-serif; background: #fff; }

          @page {
            size: A4 ${isLandscape ? 'landscape' : 'portrait'};
            margin: 10mm;
          }

          .page {
            display: grid;
            grid-template-columns: repeat(${cols}, 1fr);
            gap: ${cardSize.gap};
            width: 100%;
            /* Force exactly perPage cards — no overflow to next page */
          }
          .page-break {
            page-break-after: always;
            break-after: page;
          }

          .qr-card {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            gap: 2px;
            padding: ${cardSize.pad};
            border: 0.4pt solid #bbb;
            border-radius: 3mm;
            background: #fff;
            overflow: hidden;
          }

          .avatar {
            width: ${cardSize.avatar};
            height: ${cardSize.avatar};
            border-radius: 50%;
            object-fit: cover;
            flex-shrink: 0;
          }
          .avatar-placeholder {
            width: ${cardSize.avatar};
            height: ${cardSize.avatar};
            border-radius: 50%;
            background: #eee;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: calc(${cardSize.avatar} * 0.5);
            flex-shrink: 0;
          }
          .qr {
            width: ${cardSize.qr};
            height: ${cardSize.qr};
            flex-shrink: 0;
          }
          .name {
            font-size: ${cardSize.name};
            font-weight: 700;
            text-align: center;
            color: #111;
            word-break: break-word;
            line-height: 1.2;
          }
          .batch {
            font-size: ${cardSize.batch};
            color: #666;
            text-align: center;
          }

          @media print {
            body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
            .no-print { display: none !important; }
          }

          /* Screen preview */
          @media screen {
            body { background: #e8e8e8; padding: 16px; padding-top: 70px; }
            .page { background: #fff; padding: 10mm; margin-bottom: 16px; box-shadow: 0 2px 8px rgba(0,0,0,0.15); }
          }

          .top-bar {
            position: fixed; top: 0; left: 0; right: 0;
            background: #fff; padding: 12px 16px;
            display: flex; align-items: center; gap: 12px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.12);
            z-index: 999;
          }
          .back-btn {
            background: #f2f2f7; border: none; border-radius: 8px;
            padding: 8px 16px; font-size: 15px; font-weight: 600;
            cursor: pointer; color: #1c1c1e;
          }
          .back-btn:hover { background: #e5e5ea; }
        </style>
      </head>
      <body>
        <div class="top-bar no-print">
          <button class="back-btn" onclick="window.close()">← Back</button>
          <span style="font-size:14px;color:#666;">QR Codes Preview — click Back or close this tab to return</span>
        </div>
        ${pagesHtml}
        <script>
          window.onload = function() { setTimeout(function() { window.print(); }, 400); };
        </script>
      </body>
      </html>
    `);
    win.document.close();
  };

  const renderPrintQRs = () => {
    if (!printQRs) return null;
    return (
      <div className="print-overlay">
        <div className="print-toolbar no-print">
          <span className="print-toolbar-title">QR Codes — {selectedBatch.name}</span>
          <div className="print-toolbar-actions">
            <button className="print-go-btn" onClick={() => handlePrint('portrait')} style={{ marginRight: 6 }}>🖨 Portrait (6/page)</button>
            <button className="print-go-btn" onClick={() => handlePrint('landscape')}>🖨 Landscape (10/page)</button>
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

  const onTouchStart = (e) => {
    // Only arm pull-to-refresh if page is truly at the top
    if (window.scrollY === 0) {
      pullStartY.current = e.touches[0].clientY;
    } else {
      pullStartY.current = null;
    }
  };
  const onTouchMove = (e) => {
    if (pullStartY.current === null) return;
    // Cancel if user scrolled away from top during the move
    if (window.scrollY > 5) { pullStartY.current = null; setPullDistance(0); return; }
    const dist = e.touches[0].clientY - pullStartY.current;
    if (dist > 0) setPullDistance(Math.min(dist, 120));
    else { pullStartY.current = null; setPullDistance(0); }
  };
  const onTouchEnd = async () => {
    if (pullDistance >= PULL_THRESHOLD && !pullRefreshing) {
      setPullRefreshing(true);
      setPullDistance(0);
      pullStartY.current = null;
      try {
        if (isViewer) await fetchBatches(null);
        else if (selectedTeacher) await fetchBatches(selectedTeacher._id);
      } finally {
        setPullRefreshing(false);
      }
    } else {
      setPullDistance(0);
      pullStartY.current = null;
    }
  };

  return (
    <div
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      style={{ overflowY: 'auto', minHeight: '100vh', position: 'relative' }}
    >
      {/* Pull-to-refresh indicator */}
      {(pullDistance > 0 || pullRefreshing) && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, zIndex: 9999,
          display: 'flex', justifyContent: 'center', alignItems: 'center',
          height: pullRefreshing ? 56 : Math.min(pullDistance * 0.6, 56),
          background: 'transparent',
          transition: pullRefreshing ? 'height 0.2s' : 'none',
          overflow: 'hidden',
          pointerEvents: 'none',
        }}>
          <div style={{
            background: '#fff',
            borderRadius: '50%',
            width: 36, height: 36,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 2px 10px rgba(0,0,0,0.15)',
            transform: pullRefreshing ? 'none' : `rotate(${pullDistance * 2}deg)`,
            transition: pullRefreshing ? 'transform 0.6s linear' : 'none',
            animation: pullRefreshing ? 'spin 0.7s linear infinite' : 'none',
          }}>
            {pullRefreshing ? '🔄' : '↓'}
          </div>
        </div>
      )}
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
      {view === 'batches' && renderBatches()}
      {view === 'students' && renderStudents()}
      {view === 'categories' && renderCategories()}
      {view === 'evaluations' && renderEvaluations()}
      {view === 'evaluationDetail' && renderEvaluationDetail()}
      {view === 'examItems' && renderExamItems()}
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