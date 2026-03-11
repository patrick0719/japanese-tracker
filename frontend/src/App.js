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

// ── DOCUMENT SCANNER COMPONENT ─────────────────────────────────────────────
function DocumentScanner({ onCapture, onClose }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const overlayCanvasRef = useRef(null);
  const streamRef = useRef(null);
  const animFrameRef = useRef(null);
  const cvReadyRef = useRef(false);

  const [status, setStatus] = useState('Initializing camera...');
  const [detected, setDetected] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const stableCountRef = useRef(0);

  // Load OpenCV.js dynamically
  useEffect(() => {
    if (window.cv && window.cv.Mat) {
      cvReadyRef.current = true;
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://docs.opencv.org/4.8.0/opencv.js';
    script.async = true;
    script.onload = () => {
      const checkCV = setInterval(() => {
        if (window.cv && window.cv.Mat) {
          cvReadyRef.current = true;
          clearInterval(checkCV);
        }
      }, 100);
    };
    document.head.appendChild(script);
    return () => {
      if (document.head.contains(script)) document.head.removeChild(script);
    };
  }, []);

  // Start camera
  useEffect(() => {
    const startCamera = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1280 },
            height: { ideal: 720 }
          }
        });
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
          setStatus('Point camera at document');
          startDetection();
        }
      } catch (err) {
        setStatus('Camera access denied. Please allow camera.');
      }
    };
    startCamera();
    return () => stopAll();
  }, []); // eslint-disable-line

  const stopAll = () => {
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
  };

  // ── EDGE DETECTION LOOP ──────────────────────────────────────────
  const detectDocument = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const overlay = overlayCanvasRef.current;

    if (!video || !canvas || !overlay || video.readyState < 2) {
      animFrameRef.current = requestAnimationFrame(detectDocument);
      return;
    }

    const W = video.videoWidth;
    const H = video.videoHeight;
    canvas.width = W;
    canvas.height = H;
    overlay.width = overlay.offsetWidth;
    overlay.height = overlay.offsetHeight;

    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, W, H);

    const oCtx = overlay.getContext('2d');
    oCtx.clearRect(0, 0, overlay.width, overlay.height);

    let corners = null;

    if (cvReadyRef.current && window.cv && window.cv.Mat) {
      try {
        corners = detectWithOpenCV(canvas, W, H);
      } catch (e) {
        corners = null;
      }
    }

    if (!corners) {
      corners = detectWithCanvas(canvas, W, H);
    }

    if (corners) {
      drawCorners(oCtx, corners, overlay.width, overlay.height, W, H);
      setDetected(true);
      setStatus('Document detected! Hold still...');
      stableCountRef.current += 1;

      // Auto-capture after 30 stable frames (~1 second)
      if (stableCountRef.current >= 30 && !capturing) {
        setCapturing(true);
        setTimeout(() => captureDocument(corners, W, H), 200);
        return;
      }
    } else {
      setDetected(false);
      stableCountRef.current = 0;
      setStatus('Point camera at document');
    }

    animFrameRef.current = requestAnimationFrame(detectDocument);
  }, [capturing]); // eslint-disable-line

  const startDetection = () => {
    animFrameRef.current = requestAnimationFrame(detectDocument);
  };

  // ── OPENCV DETECTION ─────────────────────────────────────────────
  const detectWithOpenCV = (canvas, W, H) => {
    const cv = window.cv;
    const src = cv.imread(canvas);
    const gray = new cv.Mat();
    const blurred = new cv.Mat();
    const edges = new cv.Mat();
    const contours = new cv.MatVector();
    const hierarchy = new cv.Mat();

    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0);
    cv.Canny(blurred, edges, 75, 200);
    cv.findContours(edges, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

    let bestCorners = null;
    let maxArea = 0;
    const minArea = W * H * 0.1;

    for (let i = 0; i < contours.size(); i++) {
      const contour = contours.get(i);
      const peri = cv.arcLength(contour, true);
      const approx = new cv.Mat();
      cv.approxPolyDP(contour, approx, 0.02 * peri, true);

      if (approx.rows === 4) {
        const area = cv.contourArea(approx);
        if (area > maxArea && area > minArea) {
          maxArea = area;
          const pts = [];
          for (let j = 0; j < 4; j++) {
            pts.push({ x: approx.data32S[j * 2], y: approx.data32S[j * 2 + 1] });
          }
          bestCorners = orderCorners(pts);
        }
      }
      approx.delete();
      contour.delete();
    }

    src.delete(); gray.delete(); blurred.delete(); edges.delete();
    contours.delete(); hierarchy.delete();
    return bestCorners;
  };

  // ── FALLBACK CANVAS DETECTION ────────────────────────────────────
  const detectWithCanvas = (canvas, W, H) => {
    const ctx = canvas.getContext('2d');
    const SAMPLE = 4;
    const sW = Math.floor(W / SAMPLE);
    const sH = Math.floor(H / SAMPLE);
    const imageData = ctx.getImageData(0, 0, W, H);
    const data = imageData.data;

    let minX = sW, maxX = 0, minY = sH, maxY = 0;
    const threshold = 180;
    let found = false;

    for (let y = 0; y < sH; y++) {
      for (let x = 0; x < sW; x++) {
        const idx = (y * SAMPLE * W + x * SAMPLE) * 4;
        const brightness = (data[idx] + data[idx + 1] + data[idx + 2]) / 3;
        if (brightness > threshold) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
          found = true;
        }
      }
    }

    if (!found) return null;
    const rx = minX * SAMPLE;
    const ry = minY * SAMPLE;
    const rw = (maxX - minX) * SAMPLE;
    const rh = (maxY - minY) * SAMPLE;
    if (rw < W * 0.2 || rh < H * 0.2) return null;

    return [
      { x: rx, y: ry },
      { x: rx + rw, y: ry },
      { x: rx + rw, y: ry + rh },
      { x: rx, y: ry + rh }
    ];
  };

  const orderCorners = (pts) => {
    const sorted = [...pts].sort((a, b) => a.y - b.y);
    const top = sorted.slice(0, 2).sort((a, b) => a.x - b.x);
    const bottom = sorted.slice(2).sort((a, b) => a.x - b.x);
    return [top[0], top[1], bottom[1], bottom[0]];
  };

  const drawCorners = (ctx, corners, oW, oH, W, H) => {
    const scaleX = oW / W;
    const scaleY = oH / H;
    const pts = corners.map(p => ({ x: p.x * scaleX, y: p.y * scaleY }));

    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    pts.forEach(p => ctx.lineTo(p.x, p.y));
    ctx.closePath();
    ctx.strokeStyle = '#00FF88';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.fillStyle = 'rgba(0,255,136,0.12)';
    ctx.fill();

    pts.forEach(p => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 8, 0, Math.PI * 2);
      ctx.fillStyle = '#00FF88';
      ctx.fill();
    });
  };

  // ── CAPTURE ──────────────────────────────────────────────────────
  const captureDocument = (corners, W, H) => {
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    stopAll();

    const canvas = canvasRef.current;
    if (!canvas) return;

    const [tl, tr, br, bl] = corners;
    const maxW = Math.max(
      Math.hypot(tr.x - tl.x, tr.y - tl.y),
      Math.hypot(br.x - bl.x, br.y - bl.y)
    );
    const maxH = Math.max(
      Math.hypot(bl.x - tl.x, bl.y - tl.y),
      Math.hypot(br.x - tr.x, br.y - tr.y)
    );

    const dst = document.createElement('canvas');
    dst.width = Math.round(maxW);
    dst.height = Math.round(maxH);

    if (cvReadyRef.current && window.cv) {
      try {
        const cv = window.cv;
        const src = cv.imread(canvas);
        const dstMat = new cv.Mat();
        const srcPts = cv.matFromArray(4, 1, cv.CV_32FC2, [
          tl.x, tl.y, tr.x, tr.y, br.x, br.y, bl.x, bl.y
        ]);
        const dstPts = cv.matFromArray(4, 1, cv.CV_32FC2, [
          0, 0, maxW, 0, maxW, maxH, 0, maxH
        ]);
        const M = cv.getPerspectiveTransform(srcPts, dstPts);
        cv.warpPerspective(src, dstMat, M, new cv.Size(maxW, maxH));

        // Enhance for document readability
        // Keep color, just show warped image
        cv.imshow(dst, dstMat);

        src.delete(); dstMat.delete(); srcPts.delete();
        dstPts.delete(); M.delete();
      } catch (e) {
        simpleCrop(canvas, corners, dst);
      }
    } else {
      simpleCrop(canvas, corners, dst);
    }

    onCapture(dst.toDataURL('image/jpeg', 0.85));
  };

  const simpleCrop = (srcCanvas, corners, dstCanvas) => {
    const [tl, tr, br, bl] = corners;
    const x = Math.min(tl.x, bl.x);
    const y = Math.min(tl.y, tr.y);
    const w = Math.max(tr.x, br.x) - x;
    const h = Math.max(bl.y, br.y) - y;
    dstCanvas.width = w;
    dstCanvas.height = h;
    const ctx = dstCanvas.getContext('2d');
    ctx.filter = 'contrast(1.4) brightness(1.05)';
    ctx.drawImage(srcCanvas, x, y, w, h, 0, 0, w, h);
  };

  const manualCapture = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    const W = video.videoWidth;
    const H = video.videoHeight;
    canvas.width = W;
    canvas.height = H;
    canvas.getContext('2d').drawImage(video, 0, 0);
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    stopAll();
    const corners = [
      { x: W * 0.05, y: H * 0.05 },
      { x: W * 0.95, y: H * 0.05 },
      { x: W * 0.95, y: H * 0.95 },
      { x: W * 0.05, y: H * 0.95 }
    ];
    captureDocument(corners, W, H);
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, background: '#000', zIndex: 9999,
      display: 'flex', flexDirection: 'column'
    }}>
      <div style={{ position: 'relative', flex: 1, overflow: 'hidden' }}>
        <video
          ref={videoRef}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          playsInline muted
        />
        <canvas
          ref={overlayCanvasRef}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
        />
        <canvas ref={canvasRef} style={{ display: 'none' }} />

        <div style={{
          position: 'absolute', top: 20, left: '50%', transform: 'translateX(-50%)',
          background: detected ? 'rgba(0,200,100,0.85)' : 'rgba(0,0,0,0.65)',
          color: '#fff', padding: '8px 18px', borderRadius: 20,
          fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap', backdropFilter: 'blur(8px)'
        }}>
          {capturing ? '✅ Capturing...' : detected ? '🟢 ' + status : '🔍 ' + status}
        </div>

        {!detected && (
          <div style={{
            position: 'absolute', top: '10%', left: '5%', right: '5%', bottom: '20%',
            border: '2px dashed rgba(255,255,255,0.4)', borderRadius: 12, pointerEvents: 'none'
          }} />
        )}
      </div>

      <div style={{
        background: '#111', padding: '16px 24px',
        display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'space-between'
      }}>
        <button onClick={onClose} style={{
          background: 'rgba(255,255,255,0.15)', color: '#fff',
          border: 'none', borderRadius: 10, padding: '10px 20px', fontSize: 15, cursor: 'pointer'
        }}>
          Cancel
        </button>
        <div style={{ color: '#aaa', fontSize: 12, textAlign: 'center', flex: 1 }}>
          Auto-captures when document detected
        </div>
        <button onClick={manualCapture} style={{
          background: '#fff', color: '#000', border: 'none', borderRadius: 10,
          padding: '10px 20px', fontSize: 15, fontWeight: 700, cursor: 'pointer'
        }}>
          📸 Capture
        </button>
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
                    onClick={() => deleteImagePage(selectedExam._id, idx)}
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
                  onClick={() => window.open(img, '_blank')}
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
    </div>
  );
}

export default App;