import { useState, useRef, useEffect } from 'react';
import QRCode from 'qrcode';

const API = process.env.REACT_APP_API || 'http://localhost:5000/api';
// Compress image before sending to backend (~300KB max)
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

  const fileInputRef = useRef(null);
  const studentPhotoInputRef = useRef(null);

  // ── Fetch all batches on load ──────────────────────────────────
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
      const res = await fetch(`${API}/batches`);
      const data = await res.json();
      setBatches(data);
    } catch {
      alert('Cannot connect to server. Make sure backend is running on port 5000.');
    } finally {
      setLoading(false);
    }
  };

  // Resolve deep-link after batches loaded
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

  // ── Helper: sync updated batch into state ──────────────────────
  const updateBatchInState = (updatedBatch) => {
    setBatches(prev => prev.map(b => b._id === updatedBatch._id ? updatedBatch : b));
    if (selectedBatch?._id === updatedBatch._id) setSelectedBatch(updatedBatch);
  };

  // ── Navigation ─────────────────────────────────────────────────
  const goToStudents = (batch) => { setSelectedBatch(batch); setView('students'); };
  const goToExams = (student) => { setSelectedStudent(student); setView('exams'); };
  const goToExamDetail = (exam) => { setSelectedExam(exam); setView('examDetail'); };

  const goBack = () => {
    if (view === 'examDetail') { setView('exams'); setSelectedExam(null); }
    else if (view === 'exams') { setView('students'); setSelectedStudent(null); }
    else if (view === 'students') { setView('batches'); setSelectedBatch(null); }
  };

  // ── Modal ──────────────────────────────────────────────────────
  const openModal = (type) => {
    setModalType(type); setShowModal(true);
    setNewName(''); setNewExamName(''); setNewScore(''); setNewStudentPhoto(null);
  };
  const closeModal = () => {
    setShowModal(false);
    setNewName(''); setNewExamName(''); setNewScore(''); setNewStudentPhoto(null);
  };

  // ── SAVE ───────────────────────────────────────────────────────
  const saveBatch = async () => {
    if (!newName) return;
    setSaving(true);
    try {
      const res = await fetch(`${API}/batches`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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

  // ── DELETE ─────────────────────────────────────────────────────
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

  // ── IMAGE UPLOAD ───────────────────────────────────────────────
  const handleImageUpload = async (examId, file) => {
    if (!file) return;
    try {
      const compressed = await compressImage(file, 1200, 0.6);
      const res = await fetch(`${API}/batches/${selectedBatch._id}/students/${selectedStudent._id}/exams/${examId}/image`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: compressed })
      });
      const updatedBatch = await res.json();
      updateBatchInState(updatedBatch);
      const updatedStudent = updatedBatch.students.find(s => s._id === selectedStudent._id);
      if (updatedStudent) {
        setSelectedStudent(updatedStudent);
        const updatedExam = updatedStudent.exams.find(ex => ex._id === examId);
        if (updatedExam) setSelectedExam(updatedExam);
      }
    } catch { alert('Error uploading image.'); }
  };

  const triggerFileInput = (examId) => {
    fileInputRef.current.setAttribute('data-exam-id', examId);
    fileInputRef.current.click();
  };

  // ── QR GENERATION ──────────────────────────────────────────────
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

  // ── LOADING ────────────────────────────────────────────────────
  if (loading) return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '80vh', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontSize: 36 }}>⏳</div>
      <p style={{ color: '#8E8E93', fontSize: 16 }}>Loading...</p>
    </div>
  );

  // ── RENDER: Batches ────────────────────────────────────────────
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

  // ── RENDER: Students ───────────────────────────────────────────
  const renderStudents = () => (
    <>
      <div className="header-with-back">
        <button className="back-btn" onClick={goBack}>← Back</button>
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

  // ── RENDER: Exams ──────────────────────────────────────────────
  const renderExams = () => (
    <>
      <div className="header-with-back">
        <button className="back-btn" onClick={goBack}>← Back</button>
      </div>
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
              {exam.image && <span className="has-photo-badge">📷</span>}
              <button className="delete-btn-icon" onClick={(e) => deleteExam(exam._id, e)}>✕</button>
            </div>
          </div>
        </div>
      ))}
      <button className="add-button" onClick={() => openModal('exam')}>+ Add Exam</button>
    </>
  );

  // ── RENDER: Exam Detail ────────────────────────────────────────
  const renderExamDetail = () => (
    <>
      <div className="header-with-back">
        <button className="back-btn" onClick={goBack}>← Back</button>
        <h1 className="title">{selectedExam.name}</h1>
      </div>
      <div className="exam-detail-info">
        <span className="detail-badge">📅 {selectedExam.date}</span>
        <span className="detail-badge">🎯 Score: {selectedExam.score}/100</span>
      </div>
      <h2 className="section-title">Exam Paper Photo</h2>
      {selectedExam.image ? (
        <div className="image-container" onClick={() => triggerFileInput(selectedExam._id)}>
          <img src={selectedExam.image} alt="Exam" className="exam-image" />
          <p className="image-hint">Tap to change photo</p>
        </div>
      ) : (
        <div className="upload-area" onClick={() => triggerFileInput(selectedExam._id)}>
          <div className="upload-icon">📷</div>
          <p>Tap to upload or capture photo</p>
        </div>
      )}
      <button className="delete-button-full" onClick={(e) => deleteExam(selectedExam._id, e)}>
        🗑 Delete Exam
      </button>
      <input
        type="file"
        ref={fileInputRef}
        style={{ display: 'none' }}
        accept="image/*"
        capture="environment"
        onChange={(e) => {
          const examId = fileInputRef.current.getAttribute('data-exam-id');
          handleImageUpload(examId, e.target.files[0]);
          e.target.value = '';
        }}
      />
    </>
  );

  // ── RENDER: Modal ──────────────────────────────────────────────
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

  // ── RENDER: Print QRs ──────────────────────────────────────────
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
    </div>
  );
}

export default App;