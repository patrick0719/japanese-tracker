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
// ── DOCUMENT SCANNER COMPONENT ─────────────────────────────────────────────
function DocumentScanner({ onCapture, onClose }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const overlayCanvasRef = useRef(null);
  const streamRef = useRef(null);
  const animFrameRef = useRef(null);
  const stableCountRef = useRef(0);
  const lastCornersRef = useRef(null);

  const [status, setStatus] = useState('Initializing camera...');
  const [detected, setDetected] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const capturingRef = useRef(false);

  useEffect(() => {
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
          animFrameRef.current = requestAnimationFrame(detect);
        }
      } catch {
        setStatus('Camera access denied.');
      }
    };
    startCamera();
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
    };
  }, []); // eslint-disable-line

  // ── FAST EDGE DETECTION using pixel contrast ──────────────────────
  const findDocumentCorners = (imageData, W, H) => {
    const data = imageData.data;
    const STEP = 3; // sample every 3 pixels for speed

    // Build edge map using Sobel-like operator
    const edges = new Uint8Array(W * H);
    for (let y = STEP; y < H - STEP; y += STEP) {
      for (let x = STEP; x < W - STEP; x += STEP) {
        const idx = (y * W + x) * 4;
        const idxR = (y * W + x + STEP) * 4;
        const idxD = ((y + STEP) * W + x) * 4;
        const bright = (data[idx] + data[idx+1] + data[idx+2]) / 3;
        const brightR = (data[idxR] + data[idxR+1] + data[idxR+2]) / 3;
        const brightD = (data[idxD] + data[idxD+1] + data[idxD+2]) / 3;
        const grad = Math.abs(bright - brightR) + Math.abs(bright - brightD);
        if (grad > 40) edges[y * W + x] = 255;
      }
    }

    // Find bounding box of strongest edges
    // Scan from each side to find first strong edge line
    const MARGIN = Math.floor(W * 0.05);
    let top = -1, bottom = -1, left = -1, right = -1;

    // Find top edge
    for (let y = MARGIN; y < H / 2 && top === -1; y++) {
      let count = 0;
      for (let x = MARGIN; x < W - MARGIN; x++) {
        if (edges[y * W + x]) count++;
      }
      if (count > W * 0.25) top = y;
    }

    // Find bottom edge
    for (let y = H - MARGIN; y > H / 2 && bottom === -1; y--) {
      let count = 0;
      for (let x = MARGIN; x < W - MARGIN; x++) {
        if (edges[y * W + x]) count++;
      }
      if (count > W * 0.25) bottom = y;
    }

    // Find left edge
    for (let x = MARGIN; x < W / 2 && left === -1; x++) {
      let count = 0;
      for (let y = MARGIN; y < H - MARGIN; y++) {
        if (edges[y * W + x]) count++;
      }
      if (count > H * 0.2) left = x;
    }

    // Find right edge
    for (let x = W - MARGIN; x > W / 2 && right === -1; x--) {
      let count = 0;
      for (let y = MARGIN; y < H - MARGIN; y++) {
        if (edges[y * W + x]) count++;
      }
      if (count > H * 0.2) right = x;
    }

    if (top === -1 || bottom === -1 || left === -1 || right === -1) return null;

    const docW = right - left;
    const docH = bottom - top;

    // Must cover at least 30% of screen
    if (docW < W * 0.3 || docH < H * 0.3) return null;

    // Aspect ratio check — paper-like
    const ratio = docH / docW;
    if (ratio < 0.4 || ratio > 3.0) return null;

    return [
      { x: left, y: top },
      { x: right, y: top },
      { x: right, y: bottom },
      { x: left, y: bottom }
    ];
  };

  // ── CHECK STABILITY — corners must not move much ──────────────────
  const isCornersStable = (prev, curr) => {
    if (!prev) return false;
    const threshold = 15;
    return prev.every((p, i) =>
      Math.abs(p.x - curr[i].x) < threshold &&
      Math.abs(p.y - curr[i].y) < threshold
    );
  };

  const detect = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const overlay = overlayCanvasRef.current;

    if (!video || !canvas || !overlay || video.readyState < 2) {
      animFrameRef.current = requestAnimationFrame(detect);
      return;
    }

    const W = video.videoWidth;
    const H = video.videoHeight;

    // Process at half resolution for speed
    const SW = Math.floor(W / 2);
    const SH = Math.floor(H / 2);
    canvas.width = SW;
    canvas.height = SH;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, SW, SH);
    const imageData = ctx.getImageData(0, 0, SW, SH);

    overlay.width = overlay.offsetWidth;
    overlay.height = overlay.offsetHeight;
    const oCtx = overlay.getContext('2d');
    oCtx.clearRect(0, 0, overlay.width, overlay.height);

    const rawCorners = findDocumentCorners(imageData, SW, SH);

    // Scale corners back to full resolution
    const corners = rawCorners ? rawCorners.map(p => ({ x: p.x * 2, y: p.y * 2 })) : null;

    if (corners) {
      // Draw overlay
      const scaleX = overlay.width / W;
      const scaleY = overlay.height / H;
      const pts = corners.map(p => ({ x: p.x * scaleX, y: p.y * scaleY }));

      oCtx.beginPath();
      oCtx.moveTo(pts[0].x, pts[0].y);
      pts.forEach(p => oCtx.lineTo(p.x, p.y));
      oCtx.closePath();
      oCtx.strokeStyle = '#00FF88';
      oCtx.lineWidth = 3;
      oCtx.stroke();
      oCtx.fillStyle = 'rgba(0,255,136,0.1)';
      oCtx.fill();
      pts.forEach(p => {
        oCtx.beginPath();
        oCtx.arc(p.x, p.y, 10, 0, Math.PI * 2);
        oCtx.fillStyle = '#00FF88';
        oCtx.fill();
      });

      if (isCornersStable(lastCornersRef.current, corners)) {
        stableCountRef.current += 1;
      } else {
        stableCountRef.current = 0;
      }
      lastCornersRef.current = corners;

      const remaining = Math.max(0, Math.ceil((60 - stableCountRef.current) / 20));
      setDetected(true);
      if (remaining > 0) {
        setStatus(`Document detected! Hold still... ${remaining}s`);
      } else {
        setStatus('Document detected!');
      }

      // Auto-capture after 60 stable frames (~2 seconds)
      if (stableCountRef.current >= 60 && !capturingRef.current) {
        capturingRef.current = true;
        setCapturing(true);
        setTimeout(() => doCapture(corners, W, H), 300);
        return;
      }
    } else {
      stableCountRef.current = 0;
      lastCornersRef.current = null;
      setDetected(false);
      setStatus('Point camera at document');
    }

    animFrameRef.current = requestAnimationFrame(detect);
  };

  // ── CAPTURE & CROP ────────────────────────────────────────────────
  const doCapture = (corners, W, H) => {
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());

    // Draw full-res frame to canvas
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;

    canvas.width = W;
    canvas.height = H;
    canvas.getContext('2d').drawImage(video, 0, 0, W, H);

    const [tl, tr, br, bl] = corners;
    const x = Math.max(0, Math.min(tl.x, bl.x) - 10);
    const y = Math.max(0, Math.min(tl.y, tr.y) - 10);
    const w = Math.min(W - x, Math.max(tr.x, br.x) - x + 10);
    const h = Math.min(H - y, Math.max(bl.y, br.y) - y + 10);

    const dst = document.createElement('canvas');
    dst.width = w;
    dst.height = h;
    const dCtx = dst.getContext('2d');
    dCtx.drawImage(canvas, x, y, w, h, 0, 0, w, h);

    onCapture(dst.toDataURL('image/jpeg', 0.9));
  };

  const manualCapture = () => {
    if (capturingRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    capturingRef.current = true;
    setCapturing(true);
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());

    const W = video.videoWidth;
    const H = video.videoHeight;
    canvas.width = W;
    canvas.height = H;
    canvas.getContext('2d').drawImage(video, 0, 0);

    // Use last detected corners or full frame
    const corners = lastCornersRef.current || [
      { x: W * 0.05, y: H * 0.05 },
      { x: W * 0.95, y: H * 0.05 },
      { x: W * 0.95, y: H * 0.95 },
      { x: W * 0.05, y: H * 0.95 }
    ];
    doCapture(corners, W, H);
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#000', zIndex: 9999, display: 'flex', flexDirection: 'column' }}>
      <div style={{ position: 'relative', flex: 1, overflow: 'hidden' }}>
        <video ref={videoRef} style={{ width: '100%', height: '100%', objectFit: 'cover' }} playsInline muted />
        <canvas ref={overlayCanvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }} />
        <canvas ref={canvasRef} style={{ display: 'none' }} />

        <div style={{
          position: 'absolute', top: 20, left: '50%', transform: 'translateX(-50%)',
          background: detected ? 'rgba(0,180,80,0.9)' : 'rgba(0,0,0,0.7)',
          color: '#fff', padding: '8px 20px', borderRadius: 20,
          fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap'
        }}>
          {capturing ? '✅ Capturing...' : detected ? '🟢 ' + status : '🔍 ' + status}
        </div>

        {!detected && !capturing && (
          <div style={{
            position: 'absolute', top: '8%', left: '4%', right: '4%', bottom: '15%',
            border: '2px dashed rgba(255,255,255,0.35)', borderRadius: 16, pointerEvents: 'none',
            display: 'flex', alignItems: 'center', justifyContent: 'center'
          }}>
            <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13 }}>Place document here</span>
          </div>
        )}
      </div>

      <div style={{ background: '#111', padding: '16px 24px', display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'space-between' }}>
        <button onClick={onClose} style={{ background: 'rgba(255,255,255,0.15)', color: '#fff', border: 'none', borderRadius: 10, padding: '10px 20px', fontSize: 15, cursor: 'pointer' }}>
          Cancel
        </button>
        <div style={{ color: '#888', fontSize: 12, textAlign: 'center', flex: 1 }}>
          {detected ? 'Keep still for auto-capture' : 'Auto-detects document edges'}
        </div>
        <button onClick={manualCapture} disabled={capturing} style={{ background: capturing ? '#555' : '#fff', color: '#000', border: 'none', borderRadius: 10, padding: '10px 20px', fontSize: 15, fontWeight: 700, cursor: 'pointer' }}>
          📸 Capture
        </button>
      </div>
    </div>
  );
}

// ── MAIN APP ────────────────────────────────────────────────────────────────

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