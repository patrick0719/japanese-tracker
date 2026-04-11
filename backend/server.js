console.log('MONGO_URI exists:', !!process.env.MONGO_URI);
console.log('PORT:', process.env.PORT);
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const crypto = require('crypto');
require('dotenv').config();

// ── CLOUDINARY UPLOAD (via REST API — no npm package needed) ─────────────────
const cloudinaryUpload = async (base64Data) => {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  const folder = 'sage-bulacan';

  if (!cloudName || !apiKey || !apiSecret) {
    throw new Error('Cloudinary environment variables are missing');
  }

  // Cloudinary signature requires alphabetical order of parameters
  const timestamp = Math.floor(Date.now() / 1000);
  const toSign = `folder=${folder}&timestamp=${timestamp}${apiSecret}`;
  const signature = crypto.createHash('sha1').update(toSign).digest('hex');

  // Use URLSearchParams for clean, encoded, and reliable base64 transmission
  const params = new URLSearchParams();
  params.append('file', base64Data); 
  params.append('api_key', apiKey);
  params.append('timestamp', timestamp);
  params.append('signature', signature);
  params.append('folder', folder);

  const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, {
    method: 'POST',
    body: params,
  });

  const data = await response.json();

  if (data.error) {
    console.error('Cloudinary API Error:', data.error.message);
    throw new Error(data.error.message);
  }

  return { url: data.secure_url, publicId: data.public_id };
};

const cloudinaryDelete = async (publicId) => {
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const timestamp = Math.floor(Date.now() / 1000);
  const toSign = `public_id=${publicId}&timestamp=${timestamp}${apiSecret}`;
  const signature = crypto.createHash('sha1').update(toSign).digest('hex');
  await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/destroy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ public_id: publicId, api_key: apiKey, timestamp, signature }),
  });
};

const app = express();
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
  } else {
    next();
  }
});

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.log('MongoDB error:', err));

const batchSchema = new mongoose.Schema({
  name: String,
  name_ja: { type: String, default: '' },
  teacherId: { type: String, default: null },
  students: [{
    name: String,
    photo: String,
    status: { type: String, default: 'Regular' },
    isArchived: { type: Boolean, default: false },
    companyName: { type: String, default: '' },
    kumiai: { type: String, default: '' },
    categories: [{
      name: String,
      name_ja: { type: String, default: '' },
      items: [{
        name: String,
        name_ja: { type: String, default: '' },
        date: String,
        score: Number,
        totalScore: { type: Number, default: 100 },
        images: [String]
      }]
    }],
    evaluations: [{
      title: String,
      ordinal: String,
      date: String,
      fields: { type: mongoose.Schema.Types.Mixed, default: {} }
    }]
  }]
});
const Batch = mongoose.model('Batch', batchSchema);

// ── IMAGE MODEL & ROUTES (Cloudinary storage) ─────────────────────────────────
const imageSchema = new mongoose.Schema({
  url: String,       // Cloudinary URL
  publicId: String,  // Cloudinary public_id for deletion
  createdAt: { type: Date, default: Date.now }
});
const Image = mongoose.model('Image', imageSchema);

// Expose cloud name for direct browser uploads
app.get('/api/config', (req, res) => {
  res.json({ cloudName: process.env.CLOUDINARY_CLOUD_NAME });
});

// GET image by ID — returns Cloudinary URL
app.get('/api/images/:id', async (req, res) => {
  try {
    const img = await Image.findById(req.params.id);
    if (!img) return res.status(404).json({ error: 'Not found' });
    res.json({ _id: img._id, url: img.url });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST bulk fetch images by IDs — returns { id: url } map in one round-trip
app.post("/api/images/bulk", async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) return res.json({});
    const validIds = ids.filter(id => /^[a-f\d]{24}$/i.test(id));
    const images = await Image.find({ _id: { $in: validIds } }).lean();
    const map = {};
    images.forEach(img => { map[img._id.toString()] = img.url; });
    res.json(map);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST save image reference — browser uploads directly to Cloudinary,
// then sends us just the URL + publicId to store
app.post('/api/images', async (req, res) => {
  try {
    const { url, publicId } = req.body;
    if (!url) return res.status(400).json({ error: 'url required' });
    const img = new Image({ url, publicId });
    await img.save();
    res.json({ _id: img._id, url });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE image — remove from Cloudinary + MongoDB
app.delete('/api/images/:id', async (req, res) => {
  try {
    const img = await Image.findById(req.params.id);
    if (img?.publicId) await cloudinaryDelete(img.publicId).catch(() => {});
    await Image.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── TEACHER MODEL & ROUTES ───────────────────────────────────────────────────
const teacherSchema = new mongoose.Schema({
  name: String,
  emoji: { type: String, default: '👩‍🏫' },
  photo: { type: String, default: null },
  signature: { type: String, default: null },
});
const Teacher = mongoose.model('Teacher', teacherSchema);

app.get('/api/teachers', async (req, res) => {
  try { res.json(await Teacher.find().select('-signature')); } catch (err) { res.status(500).json({ error: err.message }); }
});
app.get('/api/teachers/with-signatures', async (req, res) => {
  try { res.json(await Teacher.find()); } catch (err) { res.status(500).json({ error: err.message }); }
});
app.post('/api/teachers', async (req, res) => {
  try {
    const t = new Teacher({ name: req.body.name, emoji: req.body.emoji || '👩‍🏫' });
    await t.save(); res.json(t);
  } catch (err) { res.status(500).json({ error: err.message }); }
});
app.patch('/api/teachers/:id/signature', async (req, res) => {
  try {
    const t = await Teacher.findById(req.params.id);
    if (!t) return res.status(404).json({ error: 'Teacher not found' });
    t.signature = req.body.signature;
    await t.save();
    res.json(t);
  } catch (err) { res.status(500).json({ error: err.message }); }
});
app.patch('/api/teachers/:id/photo', async (req, res) => {
  try {
    const t = await Teacher.findById(req.params.id);
    if (!t) return res.status(404).json({ error: 'Teacher not found' });
    t.photo = req.body.photo;
    await t.save();
    res.json({ _id: t._id, name: t.name, emoji: t.emoji, photo: t.photo });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
app.delete('/api/teachers/:id', async (req, res) => {
  try { await Teacher.findByIdAndDelete(req.params.id); res.json({ success: true }); } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── BATCH ROUTES ─────────────────────────────────────────────────────────────
app.get('/api/batches', async (req, res) => {
  try {
    const filter = req.query.teacherId ? { teacherId: req.query.teacherId } : {};
    res.json(await Batch.find(filter));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/batches', async (req, res) => {
  try { const b = new Batch({ name: req.body.name, name_ja: req.body.name_ja || '', teacherId: req.body.teacherId || null, students: [] }); await b.save(); res.json(b); } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/batches/:batchId', async (req, res) => {
  try { await Batch.findByIdAndDelete(req.params.batchId); res.json({ success: true }); } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/batches/:batchId/students', async (req, res) => {
  try {
    const batch = await Batch.findById(req.params.batchId);
    batch.students.push({ name: req.body.name, photo: req.body.photo || null, status: req.body.status || 'Regular', companyName: req.body.companyName || '', kumiai: req.body.kumiai || '', categories: [], evaluations: [] });
    await batch.save();
    res.json(batch);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.patch('/api/batches/:batchId/students/:studentId', async (req, res) => {
  try {
    const batch = await Batch.findById(req.params.batchId);
    const student = batch.students.id(req.params.studentId);
    if (req.body.name !== undefined) student.name = req.body.name;
    if (req.body.photo !== undefined) student.photo = req.body.photo;
    if (req.body.status !== undefined) student.status = req.body.status;
    if (req.body.companyName !== undefined) student.companyName = req.body.companyName;
    if (req.body.kumiai !== undefined) student.kumiai = req.body.kumiai;
    await batch.save();
    res.json(batch);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.patch('/api/batches/:batchId/students/:studentId/status', async (req, res) => {
  try {
    const batch = await Batch.findById(req.params.batchId);
    const student = batch.students.id(req.params.studentId);
    student.status = req.body.status;
    await batch.save(); res.json(batch);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.patch('/api/batches/:batchId/students/:studentId/archive', async (req, res) => {
  try {
    const batch = await Batch.findById(req.params.batchId);
    const student = batch.students.id(req.params.studentId);
    student.isArchived = req.body.isArchived;
    batch.markModified('students');
    await batch.save(); res.json(batch);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/batches/:batchId/students/:studentId', async (req, res) => {
  try {
    const batch = await Batch.findById(req.params.batchId);
    batch.students = batch.students.filter(s => s._id.toString() !== req.params.studentId);
    await batch.save(); res.json(batch);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── CATEGORY ROUTES ──────────────────────────────────────────────────────────
app.post('/api/batches/:batchId/students/:studentId/categories', async (req, res) => {
  try {
    const batch = await Batch.findById(req.params.batchId);
    const student = batch.students.id(req.params.studentId);
    student.categories.push({ name: req.body.name, name_ja: req.body.name_ja || '', items: [] });
    await batch.save(); res.json(batch);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/batches/:batchId/students/:studentId/categories/:catId', async (req, res) => {
  try {
    const batch = await Batch.findById(req.params.batchId);
    const student = batch.students.id(req.params.studentId);
    student.categories = student.categories.filter(c => c._id.toString() !== req.params.catId);
    await batch.save(); res.json(batch);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── EXAM ITEM ROUTES ──────────────────────────────────────────────────────────
app.post('/api/batches/:batchId/students/:studentId/categories/:catId/items', async (req, res) => {
  try {
    const batch = await Batch.findById(req.params.batchId);
    const student = batch.students.id(req.params.studentId);
    const cat = student.categories.id(req.params.catId);
    const newItem = { name: req.body.name, name_ja: req.body.name_ja || '', date: new Date().toISOString().split('T')[0], score: req.body.score, totalScore: req.body.totalScore || 100, images: [] };
    cat.items.push(newItem);
    await batch.save();
    res.json(cat.items[cat.items.length - 1]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/batches/:batchId/students/:studentId/categories/:catId/items/:itemId', async (req, res) => {
  try {
    const batch = await Batch.findById(req.params.batchId);
    const student = batch.students.id(req.params.studentId);
    const cat = student.categories.id(req.params.catId);
    cat.items = cat.items.filter(i => i._id.toString() !== req.params.itemId);
    await batch.save(); res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.patch('/api/batches/:batchId/students/:studentId/categories/:catId/items/:itemId/image', async (req, res) => {
  try {
    const { url, publicId, image } = req.body;

    let imageId;

    if (url) {
      // FLOW A: browser uploads to Cloudinary directly, sends url + publicId
      const img = new Image({ url, publicId });
      await img.save();
      imageId = img._id.toString();
    } else if (image && /^[a-f\d]{24}$/i.test(image)) {
      // FLOW B: App already saved via POST /api/images, just use the returned _id
      imageId = image;
    } else {
      return res.status(400).json({ error: 'No image data provided' });
    }

    const batch = await Batch.findById(req.params.batchId);
    const student = batch.students.id(req.params.studentId);
    const cat = student.categories.id(req.params.catId);
    const item = cat.items.id(req.params.itemId);
    if (!item.images) item.images = [];
    item.images.push(imageId);
    await batch.save();
    res.json({ success: true, imageId });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.patch('/api/batches/:batchId/students/:studentId/categories/:catId/items/:itemId/remove-image', async (req, res) => {
  try {
    const batch = await Batch.findById(req.params.batchId);
    const student = batch.students.id(req.params.studentId);
    const cat = student.categories.id(req.params.catId);
    const item = cat.items.id(req.params.itemId);
    const { index } = req.body;
    if (item.images && item.images[index] !== undefined) {
      const imageId = item.images[index];
      if (imageId && !imageId.startsWith('data:')) {
        await Image.findByIdAndDelete(imageId).catch(() => {});
      }
      item.images.splice(index, 1);
    }
    await batch.save(); res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── EVALUATION ROUTES ─────────────────────────────────────────────────────────
app.get('/api/batches/:batchId/students/:studentId/evaluations', async (req, res) => {
  try {
    const batch = await Batch.findById(req.params.batchId);
    const student = batch.students.id(req.params.studentId);
    res.json(student.evaluations || []);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/batches/:batchId/students/:studentId/evaluations', async (req, res) => {
  try {
    const batch = await Batch.findById(req.params.batchId);
    const student = batch.students.id(req.params.studentId);
    student.evaluations.push({ title: req.body.title, ordinal: req.body.ordinal, date: req.body.date, fields: {} });
    await batch.save();
    const newEval = student.evaluations[student.evaluations.length - 1];
    res.json(newEval);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.patch('/api/batches/:batchId/students/:studentId/evaluations/:evalId', async (req, res) => {
  try {
    const batch = await Batch.findById(req.params.batchId);
    const student = batch.students.id(req.params.studentId);
    const ev = student.evaluations.id(req.params.evalId);
    if (req.body.fields !== undefined) ev.fields = req.body.fields;
    if (req.body.title !== undefined) ev.title = req.body.title;
    if (req.body.date !== undefined) ev.date = req.body.date;
    batch.markModified('students');
    await batch.save();
    res.json(ev);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/batches/:batchId/students/:studentId/evaluations/:evalId', async (req, res) => {
  try {
    const batch = await Batch.findById(req.params.batchId);
    const student = batch.students.id(req.params.studentId);
    student.evaluations = student.evaluations.filter(ev => ev._id.toString() !== req.params.evalId);
    await batch.save();
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── ARCHIVE: migrate base64 images to Cloudinary ─────────────────────────────
app.post('/api/archive/migrate-base64', async (req, res) => {
  try {
    const batches = await Batch.find();
    let migrated = 0, skipped = 0, failed = 0;
    const errors = [];

    for (const batch of batches) {
      let batchChanged = false;

      for (const student of batch.students) {
        for (const cat of student.categories) {
          for (const item of cat.items) {
            for (let i = 0; i < (item.images || []).length; i++) {
              const imgRef = item.images[i];

              if (/^[a-f\d]{24}$/i.test(imgRef)) {
                const imgDoc = await Image.findById(imgRef);
                if (!imgDoc) { skipped++; continue; }
                if (imgDoc.url && imgDoc.url.startsWith('http')) { skipped++; continue; }
                try {
                  const { url, publicId } = await cloudinaryUpload(imgDoc.url || imgDoc.data);
                  imgDoc.url = url;
                  imgDoc.publicId = publicId;
                  await imgDoc.save();
                  migrated++;
                  batchChanged = true;
                } catch (e) {
                  failed++;
                  errors.push({ student: student.name, item: item.name, error: e.message });
                }
              } else if (imgRef && imgRef.startsWith('data:')) {
                try {
                  const { url, publicId } = await cloudinaryUpload(imgRef);
                  const newImg = new Image({ url, publicId });
                  await newImg.save();
                  item.images[i] = newImg._id.toString();
                  migrated++;
                  batchChanged = true;
                } catch (e) {
                  failed++;
                  errors.push({ student: student.name, item: item.name, error: e.message });
                }
              } else {
                skipped++;
              }
            }
          }
        }
      }

      if (batchChanged) await batch.save();
    }

    res.json({ success: true, migrated, skipped, failed, errors });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── CLOUDINARY ARCHIVE UPLOAD (bagong account) ───────────────────────────────
const cloudinaryArchiveUpload = async (base64Data) => {
  const cloudName = process.env.CLOUDINARY_ARCHIVE_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_ARCHIVE_API_KEY;
  const apiSecret = process.env.CLOUDINARY_ARCHIVE_API_SECRET;

  const base64 = base64Data.replace(/^data:image\/\w+;base64,/, '');
  const timestamp = Math.floor(Date.now() / 1000);
  const folder = 'sage-archive';
  const toSign = `folder=${folder}&timestamp=${timestamp}${apiSecret}`;
  const signature = crypto.createHash('sha1').update(toSign).digest('hex');

  const boundary = '----FormBoundary' + Math.random().toString(36).slice(2);
  const CRLF = '\r\n';
  const parts = [
    `--${boundary}${CRLF}Content-Disposition: form-data; name="file"${CRLF}${CRLF}data:image/jpeg;base64,${base64}`,
    `--${boundary}${CRLF}Content-Disposition: form-data; name="api_key"${CRLF}${CRLF}${apiKey}`,
    `--${boundary}${CRLF}Content-Disposition: form-data; name="timestamp"${CRLF}${CRLF}${timestamp}`,
    `--${boundary}${CRLF}Content-Disposition: form-data; name="signature"${CRLF}${CRLF}${signature}`,
    `--${boundary}${CRLF}Content-Disposition: form-data; name="folder"${CRLF}${CRLF}${folder}`,
    `--${boundary}--`,
  ];
  const body = parts.join(CRLF);

  const res = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, {
    method: 'POST',
    headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
    body,
  });
  const data = await res.json();
  if (!data.secure_url) throw new Error(data.error?.message || 'Archive upload failed');
  return { url: data.secure_url, publicId: data.public_id };
};

// ── ARCHIVE BATCH: move all images to archive Cloudinary ─────────────────────
app.post('/api/archive/batch/:batchId', async (req, res) => {
  try {
    const batch = await Batch.findById(req.params.batchId);
    if (!batch) return res.status(404).json({ error: 'Batch not found' });

    let migrated = 0, skipped = 0, failed = 0;
    const errors = [];

    for (const student of batch.students) {
      for (const cat of student.categories) {
        for (const item of cat.items) {
          for (let i = 0; i < (item.images || []).length; i++) {
            const imgRef = item.images[i];
            if (!/^[a-f\d]{24}$/i.test(imgRef)) { skipped++; continue; }

            const imgDoc = await Image.findById(imgRef);
            if (!imgDoc?.url) { skipped++; continue; }

            if (imgDoc.url.includes(process.env.CLOUDINARY_ARCHIVE_CLOUD_NAME)) {
              skipped++; continue;
            }

            try {
              const fetchRes = await fetch(imgDoc.url);
              const arrayBuffer = await fetchRes.arrayBuffer();
              const base64 = Buffer.from(arrayBuffer).toString('base64');
              const mimeType = fetchRes.headers.get('content-type') || 'image/jpeg';
              const dataUrl = `data:${mimeType};base64,${base64}`;

              const { url, publicId } = await cloudinaryArchiveUpload(dataUrl);
              imgDoc.url = url;
              imgDoc.publicId = publicId;
              await imgDoc.save();
              migrated++;
            } catch (e) {
              failed++;
              errors.push({ student: student.name, item: item.name, error: e.message });
            }
          }
        }
      }
    }

    res.json({ success: true, batch: batch.name, migrated, skipped, failed, errors });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── CLEANUP: delete empty Image documents ────────────────────────────────────
app.delete('/api/diagnostic/cleanup-empty', async (req, res) => {
  try {
    const result = await Image.deleteMany({ url: { $exists: false } });
    res.json({ deleted: result.deletedCount });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── ARCHIVE STUDENT: move one student's images to archive Cloudinary ──────────
app.post('/api/archive/student/:batchId/:studentId', async (req, res) => {
  try {
    const batch = await Batch.findById(req.params.batchId);
    if (!batch) return res.status(404).json({ error: 'Batch not found' });
    const student = batch.students.id(req.params.studentId);
    if (!student) return res.status(404).json({ error: 'Student not found' });

    let migrated = 0, skipped = 0, failed = 0;
    const errors = [];

    for (const cat of student.categories) {
      for (const item of cat.items) {
        for (let i = 0; i < (item.images || []).length; i++) {
          const imgRef = item.images[i];
          if (!/^[a-f\d]{24}$/i.test(imgRef)) { skipped++; continue; }

          const imgDoc = await Image.findById(imgRef);
          if (!imgDoc?.url) { skipped++; continue; }

          if (imgDoc.url.includes(process.env.CLOUDINARY_ARCHIVE_CLOUD_NAME)) {
            skipped++; continue;
          }

          try {
            const fetchRes = await fetch(imgDoc.url);
            const arrayBuffer = await fetchRes.arrayBuffer();
            const base64 = Buffer.from(arrayBuffer).toString('base64');
            const mimeType = fetchRes.headers.get('content-type') || 'image/jpeg';
            const dataUrl = `data:${mimeType};base64,${base64}`;

            const { url, publicId } = await cloudinaryArchiveUpload(dataUrl);
            imgDoc.url = url;
            imgDoc.publicId = publicId;
            await imgDoc.save();
            migrated++;
          } catch (e) {
            failed++;
            errors.push({ item: item.name, error: e.message });
          }
        }
      }
    }

    res.json({ success: true, student: student.name, migrated, skipped, failed, errors });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── RESTORE STUDENT: move images back to main Cloudinary ─────────────────────
app.post('/api/archive/restore/:batchId/:studentId', async (req, res) => {
  try {
    const batch = await Batch.findById(req.params.batchId);
    if (!batch) return res.status(404).json({ error: 'Batch not found' });
    const student = batch.students.id(req.params.studentId);
    if (!student) return res.status(404).json({ error: 'Student not found' });

    let migrated = 0, skipped = 0, failed = 0;
    const errors = [];

    for (const cat of student.categories) {
      for (const item of cat.items) {
        for (let i = 0; i < (item.images || []).length; i++) {
          const imgRef = item.images[i];
          if (!/^[a-f\d]{24}$/i.test(imgRef)) { skipped++; continue; }

          const imgDoc = await Image.findById(imgRef);
          if (!imgDoc?.url) { skipped++; continue; }

          if (!imgDoc.url.includes(process.env.CLOUDINARY_ARCHIVE_CLOUD_NAME)) {
            skipped++; continue;
          }

          try {
            const fetchRes = await fetch(imgDoc.url);
            const arrayBuffer = await fetchRes.arrayBuffer();
            const base64 = Buffer.from(arrayBuffer).toString('base64');
            const mimeType = fetchRes.headers.get('content-type') || 'image/jpeg';
            const dataUrl = `data:${mimeType};base64,${base64}`;

            const { url, publicId } = await cloudinaryUpload(dataUrl);
            imgDoc.url = url;
            imgDoc.publicId = publicId;
            await imgDoc.save();
            migrated++;
          } catch (e) {
            failed++;
            errors.push({ item: item.name, error: e.message });
          }
        }
      }
    }

    res.json({ success: true, student: student.name, migrated, skipped, failed, errors });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PERMANENT DELETE STUDENT: delete all images + student record ──────────────
app.delete('/api/archive/permanent/:batchId/:studentId', async (req, res) => {
  try {
    const batch = await Batch.findById(req.params.batchId);
    if (!batch) return res.status(404).json({ error: 'Batch not found' });
    const student = batch.students.id(req.params.studentId);
    if (!student) return res.status(404).json({ error: 'Student not found' });

    for (const cat of student.categories) {
      for (const item of cat.items) {
        for (const imgRef of (item.images || [])) {
          if (!/^[a-f\d]{24}$/i.test(imgRef)) continue;
          const imgDoc = await Image.findById(imgRef);
          if (imgDoc?.publicId) {
            await cloudinaryDelete(imgDoc.publicId).catch(() => {});
          }
          await Image.findByIdAndDelete(imgRef).catch(() => {});
        }
      }
    }

    batch.students = batch.students.filter(s => s._id.toString() !== req.params.studentId);
    await batch.save();

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── CLOUDINARY STORAGE USAGE ──────────────────────────────────────────────────
app.get('/api/admin/storage-usage', async (req, res) => {
  try {
    const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
    const apiKey    = process.env.CLOUDINARY_API_KEY;
    const apiSecret = process.env.CLOUDINARY_API_SECRET;

    if (!cloudName || !apiKey || !apiSecret) {
      return res.status(500).json({ error: 'Cloudinary credentials not configured. Add CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET to Railway env vars.' });
    }

    const auth = Buffer.from(`${apiKey}:${apiSecret}`).toString('base64');
    const usageRes = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/usage`, {
      headers: { Authorization: `Basic ${auth}` }
    });

    if (!usageRes.ok) {
      const text = await usageRes.text();
      return res.status(500).json({ error: `Cloudinary API error: ${usageRes.status} — ${text.substring(0, 100)}` });
    }

    const usage = await usageRes.json();
    if (usage.error) return res.status(500).json({ error: usage.error.message });

    res.json({
      used_bytes:  usage.storage?.usage || 0,
      limit_bytes: usage.storage?.limit || 25 * 1024 * 1024 * 1024,
      bandwidth:   { used: usage.bandwidth?.usage || 0, limit: usage.bandwidth?.limit || 0 },
      resources: {
        image_count: usage.resources?.image?.usage || 0,
        image_size:  usage.resources?.image?.usage_bytes || 0,
      },
      last_updated: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
// ── SERVER MONITOR ────────────────────────────────────────────────────────────
// Tracks request counts since server started
let requestCount = 0;
let requestCountThisHour = 0;
let hourStart = Date.now();

app.use((req, res, next) => {
  requestCount++;
  // Reset hourly counter every 60 minutes
  if (Date.now() - hourStart > 60 * 60 * 1000) {
    requestCountThisHour = 0;
    hourStart = Date.now();
  }
  requestCountThisHour++;
  next();
});

app.get('/api/admin/server-stats', async (req, res) => {
  try {
    const memUsage = process.memoryUsage();
    const uptimeSeconds = process.uptime();

    const hours = Math.floor(uptimeSeconds / 3600);
    const minutes = Math.floor((uptimeSeconds % 3600) / 60);
    const seconds = Math.floor(uptimeSeconds % 60);
    const uptimeStr = `${hours}h ${minutes}m ${seconds}s`;

    // DB stats
    const dbState = mongoose.connection.readyState;
    const dbStateLabel = ['disconnected', 'connected', 'connecting', 'disconnecting'][dbState] || 'unknown';
    const batchCount = await Batch.countDocuments();
    const imageCount = await Image.countDocuments();
    const teacherCount = await Teacher.countDocuments();

    // ── Render API: real billing usage ───────────────────────────────────────
    let renderBilling = null;
    const RENDER_API_KEY = process.env.RENDER_API_KEY;
    if (RENDER_API_KEY) {
      try {
        // 1. Get list of services
        const svcRes = await fetch('https://api.render.com/v1/services?limit=20&type=web_service', {
          headers: { Authorization: `Bearer ${RENDER_API_KEY}`, Accept: 'application/json' }
        });
        const svcData = await svcRes.json();

        // 2. Get bandwidth usage for this month
        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
        const bwRes = await fetch(
          `https://api.render.com/v1/metrics/bandwidth?startTime=${startOfMonth}&endTime=${now.toISOString()}`,
          { headers: { Authorization: `Bearer ${RENDER_API_KEY}`, Accept: 'application/json' } }
        );
        const bwData = await bwRes.json();

        // 3. Parse services
        const services = Array.isArray(svcData) ? svcData.map(s => s.service || s) : [];
        const thisService = services.find(s =>
          s?.serviceDetails?.url?.includes('japanese-tracker') ||
          s?.name?.toLowerCase().includes('japanese') ||
          s?.name?.toLowerCase().includes('tracker')
        ) || services[0];

        // 4. Compute estimated instance hours from deploy createdAt
        // Render free tier: 750 hrs/month per workspace
        const LIMIT = 750;
        const hoursThisMonth = (Date.now() - new Date(now.getFullYear(), now.getMonth(), 1).getTime()) / (1000 * 60 * 60);
        const hoursUsed = parseFloat(Math.min(hoursThisMonth, LIMIT).toFixed(1));
        const hoursLeft = parseFloat(Math.max(LIMIT - hoursUsed, 0).toFixed(1));

        // 5. Bandwidth total in bytes
        let totalBandwidthBytes = 0;
        if (Array.isArray(bwData)) {
          totalBandwidthBytes = bwData.reduce((sum, point) => sum + (point.value || 0), 0);
        } else if (bwData?.data) {
          totalBandwidthBytes = bwData.data.reduce((sum, point) => sum + (point.value || 0), 0);
        }

        renderBilling = {
          hoursUsed,
          hoursLeft,
          limitHours: LIMIT,
          percentUsed: parseFloat(((hoursUsed / LIMIT) * 100).toFixed(1)),
          willSuspend: hoursLeft < 50,
          bandwidthUsedBytes: totalBandwidthBytes,
          bandwidthLimitBytes: 100 * 1024 * 1024 * 1024, // 100GB free tier limit
          services: services.map(s => ({
            name: s?.name || '—',
            status: s?.suspended || 'not_suspended',
            url: s?.serviceDetails?.url || null,
            plan: s?.serviceDetails?.plan || s?.plan || 'free',
            region: s?.serviceDetails?.region || '—',
            createdAt: s?.createdAt || null,
          })),
          thisService: thisService ? {
            name: thisService?.name,
            status: thisService?.suspended,
            url: thisService?.serviceDetails?.url,
            plan: thisService?.serviceDetails?.plan || 'free',
          } : null,
          apiAvailable: true,
        };
      } catch (renderErr) {
        console.error('[render-api]', renderErr.message);
        renderBilling = { apiAvailable: false, error: renderErr.message };
      }
    } else {
      // Fallback: estimate from calendar time
      const now = new Date();
      const hoursThisMonth = (Date.now() - new Date(now.getFullYear(), now.getMonth(), 1).getTime()) / (1000 * 60 * 60);
      const LIMIT = 750;
      renderBilling = {
        hoursUsed: parseFloat(Math.min(hoursThisMonth, LIMIT).toFixed(1)),
        hoursLeft: parseFloat(Math.max(LIMIT - hoursThisMonth, 0).toFixed(1)),
        limitHours: LIMIT,
        percentUsed: parseFloat((Math.min(hoursThisMonth, LIMIT) / LIMIT * 100).toFixed(1)),
        willSuspend: (LIMIT - hoursThisMonth) < 50,
        apiAvailable: false,
        error: 'RENDER_API_KEY not set — showing calendar estimate',
      };
    }

    res.json({
      uptime: uptimeStr,
      uptimeSeconds,
      memory: {
        used: memUsage.heapUsed,
        total: memUsage.heapTotal,
        rss: memUsage.rss,
        external: memUsage.external,
      },
      requests: {
        total: requestCount,
        thisHour: requestCountThisHour,
      },
      render: renderBilling,
      database: {
        status: dbStateLabel,
        batches: batchCount,
        images: imageCount,
        teachers: teacherCount,
      },
      node: {
        version: process.version,
        platform: process.platform,
        env: process.env.NODE_ENV || 'development',
      },
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log('Server running on port ' + PORT));

// ── TRANSLATE ROUTE (Taglish map + MyMemory + post-processing) ───────────────

const TAGLISH_MAP = [
  ['magaling siya', 'とても優秀な生徒です。'],
  ['magaling na magaling', '非常に優れた実力を持っています。'],
  ['magaling sa japanese', '日本語がとても上手です。'],
  ['magaling sa reading', '読解力が優れています。'],
  ['magaling sa listening', '聴解力が優れています。'],
  ['magaling sa speaking', '会話力が優れています。'],
  ['magaling sa writing', '書く力が優れています。'],
  ['magaling sa grammar', '文法の理解が優れています。'],
  ['magaling sa kanji', '漢字の習得が優れています。'],
  ['magaling sa vocabulary', '語彙力が優れています。'],
  ['napaka galing', '非常に素晴らしい実力です。'],
  ['napakagaling', '非常に素晴らしい実力です。'],
  ['galing niya', 'とても優秀です。'],
  ['mabilis matuto', '飲み込みが早く、学習能力が高いです。'],
  ['mabilis umintindi', '理解力が高く、授業についていくのが早いです。'],
  ['mabilis mag absorb', '吸収力が高く、新しい内容もすぐに習得します。'],
  ['mabilis makuha', '新しい内容を素早く理解できます。'],
  ['mabilis', '理解が速く、学習のペースが良いです。'],
  ['maayos ang pronunciation', '発音がとても正確です。'],
  ['maayos ang writing', '文字を丁寧に書くことができます。'],
  ['maayos mag sulat', '丁寧に文字を書くことができます。'],
  ['maayos mag sagot', '的確に答えることができます。'],
  ['maayos', 'とても丁寧に取り組んでいます。'],
  ['lagi siyang aktibo', 'いつも積極的に授業に参加しています。'],
  ['lagi pumapasok', '出席率が良く、継続的に学習しています。'],
  ['lagi nagtatanong', '積極的に質問し、学習意欲が高いです。'],
  ['lagi naghahanda', 'いつも予習をしっかりしてきます。'],
  ['palagi siyang handa', '常に準備万端で授業に臨んでいます。'],
  ['palagi aktibo', 'いつも積極的に参加しています。'],
  ['masipag', 'とても勤勉で、努力を惜しみません。'],
  ['napaka sipag', '非常に勤勉で、学習への意欲が高いです。'],
  ['sipag na sipag', 'たいへん努力家で、日々の学習に真剣です。'],
  ['magsipag siya', 'さらに努力を続けてほしいです。'],
  ['masipag siya', 'とても勤勉に取り組んでいます。'],
  ['malaki ang improvement', '大きく成長が見られます。'],
  ['malaki ang nagawa', '着実に成果が上がっています。'],
  ['malaki ang progress', '著しい進歩が見られます。'],
  ['maganda ang progress', '順調に上達しています。'],
  ['maganda ang improvement', '素晴らしい伸びを見せています。'],
  ['maganda ang pagbabago', '良い変化が見られます。'],
  ['nagpapabuti', '着実に上達しています。'],
  ['nagbabago na', '良い方向に変化しています。'],
  ['tumataas ang grado', '成績が向上しています。'],
  ['bumubuti na', 'だんだん上達してきています。'],
  ['masayahin', 'いつも明るく、クラスの雰囲気を良くしています。'],
  ['magalang', '礼儀正しく、好感が持てます。'],
  ['mabait', '素直で、学習態度がとても良いです。'],
  ['matiyaga', '粘り強く、諦めずに取り組んでいます。'],
  ['mapagkakatiwalaan', '信頼できる生徒です。'],
  ['seryoso sa pag-aaral', '学習に真剣に取り組んでいます。'],
  ['motivated siya', '学習意欲が高く、モチベーションが感じられます。'],
  ['dedicated siya', '学習に対する姿勢が素晴らしいです。'],
  ['passionate sa japanese', '日本語への情熱が感じられます。'],
  ['interesado sa japanese', '日本語への関心が高く、意欲的です。'],
  ['tamad', 'もう少し自主的に取り組む姿勢を見せてほしいです。'],
  ['medyo tamad', '学習への積極性をもう少し高めましょう。'],
  ['masyado tamad', '学習態度を改善する必要があります。'],
  ['hindi seryoso', 'もう少し真剣に取り組んでほしいです。'],
  ['hindi focused', '集中して授業に取り組む習慣をつけましょう。'],
  ['hindi nagcoconsistency', '継続的な学習習慣を身につけることが大切です。'],
  ['kailangan mag aral pa', 'さらに学習を重ねる必要があります。'],
  ['kailangan mag practice pa', 'より多くの練習が必要です。'],
  ['kailangan mag review', '復習をしっかり行うことが大切です。'],
  ['kailangan pag tuunan', '重点的に取り組む必要がある部分があります。'],
  ['kailangan mapabuti', '改善が必要な点があります。'],
  ['kailangan mag focus', '集中して取り組むことが必要です。'],
  ['kailangan magtiyaga', '粘り強く継続することが大切です。'],
  ['hindi pa handa', 'まだ準備が十分ではありません。'],
  ['hindi pa sapat', 'まだ十分な理解には至っていません。'],
  ['hindi pa consistent', '一貫した学習ができていません。'],
  ['hindi marunong mag review', '復習の習慣をつける必要があります。'],
  ['hindi nagre-review', '復習をする習慣をつけましょう。'],
  ['hindi nagtatanong', 'わからないことは積極的に質問しましょう。'],
  ['hindi pumupunta', '出席率を改善する必要があります。'],
  ['hindi nakikinig', '授業中はしっかり聞く姿勢を持ちましょう。'],
  ['mahirap para sa kanya', '難しい部分もありますが、努力を続けてほしいです。'],
  ['nahihirapan sa kanji', '漢字の習得に苦労していますが、継続的な練習が大切です。'],
  ['nahihirapan sa grammar', '文法の理解にもう少し時間が必要です。'],
  ['nahihirapan sa speaking', 'スピーキングの練習をもっと積みましょう。'],
  ['nahihirapan sa reading', '読解練習をさらに重ねましょう。'],
  ['nahihirapan sa listening', 'リスニング練習をもっと積みましょう。'],
  ['naiistress sa japanese', '日本語の学習にストレスを感じているようですが、焦らず一歩ずつ進みましょう。'],
  ['dapat mag aral nang mas mabuti', 'より一層努力して学習に取り組んでほしいです。'],
  ['dapat mag practice', '日頃から練習する習慣をつけましょう。'],
  ['dapat mag focus', '授業に集中して取り組みましょう。'],
  ['dapat mag review', '毎回しっかりと復習をしましょう。'],
  ['dapat mapabilis', '学習のペースをもう少し上げましょう。'],
  ['dapat makinig', '授業中はしっかり聞きましょう。'],
  ['dapat dumalo', 'できる限り出席するようにしましょう。'],
  ['mabilis magbasa', '読むスピードが速く、読解力があります。'],
  ['mahusay magbasa', '読解力が高く、文章をよく理解できています。'],
  ['mahirap magbasa', '読解練習をもっと積む必要があります。'],
  ['kailangan mag practice ng reading', '読解練習をさらに積みましょう。'],
  ['maganda ang reading', '読解力が順調に伸びています。'],
  ['maayos ang sulat', '文字を丁寧に、正確に書くことができます。'],
  ['malabo ang sulat', '文字をもっと丁寧に書く練習をしましょう。'],
  ['maganda ang sulat', '文字が美しく、丁寧に書けています。'],
  ['mahirap magsulat', '書く練習をもっと積みましょう。'],
  ['kailangan mag practice ng writing', 'ライティングの練習を続けましょう。'],
  ['mahirap mag salita', 'もっとスピーキングの練習をしましょう。'],
  ['mahusay magsalita', '会話力が高く、自然に話すことができます。'],
  ['daldal', '積極的に話す姿勢があり、会話力が伸びています。'],
  ['mahiyain magsalita', 'もっと自信を持って話す練習をしましょう。'],
  ['kailangan mag practice ng speaking', 'スピーキングの練習をもっと積みましょう。'],
  ['mag practice ng conversation', '日常的に会話練習をするよう心がけましょう。'],
  ['mabilis umintindi ng japanese', '日本語の聴解力が高く、素早く理解できます。'],
  ['mahirap umintindi ng japanese', 'リスニング力をさらに鍛える必要があります。'],
  ['maganda ang listening', '聴解力が順調に伸びています。'],
  ['kailangan mag practice ng listening', 'リスニング練習をもっと積みましょう。'],
  ['maraming alam na salita', '語彙力が豊富で、表現の幅が広いです。'],
  ['kaunti ang alam na salita', '語彙力をさらに伸ばす必要があります。'],
  ['kailangan mag memorize ng vocab', '語彙の暗記練習を続けましょう。'],
  ['magstudy ng vocab', '毎日少しずつ語彙を増やしましょう。'],
  ['marami pang kailangan matuto', 'まだ多くのことを学ぶ必要がありますが、着実に前進しています。'],
  ['maayos ang grammar', '文法の理解が正確です。'],
  ['maraming grammar mistakes', '文法のミスを減らすよう、復習を重ねましょう。'],
  ['kailangan mag focus sa grammar', '文法の学習に重点を置きましょう。'],
  ['hindi pa maayos ang grammar', '文法力をさらに向上させる必要があります。'],
  ['magaling sa kanji', '漢字の習得が非常に優れています。'],
  ['mahirap ang kanji para sa kanya', '漢字の学習に苦労していますが、繰り返し練習することで必ず上達します。'],
  ['kailangan mag practice ng kanji', '漢字の練習を毎日続けましょう。'],
  ['marami nang natutunan na kanji', '多くの漢字を習得しており、着実に力がついています。'],
  ['handa na sa n5', 'JLPT N5の受験準備が整っています。'],
  ['handa na sa n4', 'JLPT N4の受験準備が整っています。'],
  ['handa na sa n3', 'JLPT N3の受験準備が整っています。'],
  ['handa na sa jlpt', 'JLPTの受験に向けて準備ができています。'],
  ['dapat mag review para sa jlpt', 'JLPT合格に向けて、復習をしっかり行いましょう。'],
  ['may kaya para sa n5', 'JLPT N5合格の実力があります。'],
  ['may kaya para sa n4', 'JLPT N4合格の実力があります。'],
  ['mag aral para sa jlpt', 'JLPT合格を目指して継続的に学習しましょう。'],
  ['papasa sa jlpt', 'このまま続ければJLPT合格も十分可能です。'],
  ['malamang papasa', '現在の調子を維持すれば、合格が期待できます。'],
  ['laging present', '出席率が非常に良く、継続的に学習しています。'],
  ['laging absent', '欠席が多く、学習の継続が心配です。'],
  ['maraming absent', '欠席が多いため、学習の遅れが見られます。'],
  ['kailangan dumalo', 'できる限り授業に出席するよう心がけましょう。'],
  ['maayos ang dating', '時間通りに来て、授業への取り組みが良いです。'],
  ['laging late', '時間を守って登校する習慣をつけましょう。'],
  ['magaling pero madalas absent', '実力はありますが、欠席が多いことが懸念されます。'],
  ['responsive sa class', '授業中の反応が良く、積極的に参加しています。'],
  ['tahimik sa class', '授業中にもっと積極的に発言するよう心がけましょう。'],
  ['aktibo sa class', '授業に積極的に参加しており、学習意欲が感じられます。'],
  ['madaldal sa class', '授業中の発言が多く、活発に参加しています。'],
  ['magalang sa teacher', '先生に対して礼儀正しく接しています。'],
  ['magandang ugali', '礼儀正しく、学習態度が良いです。'],
  ['helpful sa classmates', 'クラスメートにも優しく、協力的な姿勢が見られます。'],
  ['keep it up', 'この調子で頑張り続けてください。'],
  ['keep going', 'このまま継続して学習を続けましょう。'],
  ['huwag sumuko', '諦めずに努力を続けてください。'],
  ['huwag mag give up', '途中で諦めず、最後まで頑張りましょう。'],
  ['kaya niya', '必ず達成できると信じています。'],
  ['kaya mo yan', 'あなたならきっとできます。'],
  ['magtiwala sa sarili', '自分の力を信じて取り組みましょう。'],
  ['konti na lang', '目標達成まであと少しです。'],
  ['malapit na', '目標まであと少しのところまで来ています。'],
  ['may potential siya', '大きな可能性を持っている生徒です。'],
  ['may talent siya', '日本語学習において才能が感じられます。'],
  ['proud kami sa kanya', 'その頑張りを誇りに思います。'],
  ['magandang simula', '良いスタートが切れています。'],
  ['magpatuloy lang', 'このまま学習を続けていきましょう。'],
  ['nasa tamang daan na siya', '正しい方向に向かって進んでいます。'],
  ['tulungan natin siya', '一緒に頑張っていきましょう。'],
  ['suportahan natin siya', '継続的なサポートが成長につながります。'],
  ['nandoon na siya', '目標のレベルに近づいています。'],
  ['magandang student', 'とても良い生徒です。'],
  ['mahusay na student', '優秀な生徒です。'],
  ['promising student', '将来が期待できる生徒です。'],
  ['may improvement', '成長の跡が見られます。'],
  ['walang improvement', '改善が見られないため、学習方法を見直す必要があります。'],
  ['kailangan mag consistent', '一貫した学習が大切です。'],
  ['inconsistent siya', '学習が不安定で、継続性が必要です。'],
  ['consistent siya', '安定した学習が続いており、着実に力がついています。'],
  ['nasa level na siya', '現在のレベルに十分達しています。'],
  ['hindi pa nasa level', 'まだ目標のレベルには達していません。'],
  ['ready na mag advance', '次のレベルに進む準備ができています。'],
  ['hindi pa ready mag advance', 'まだ次のレベルに進む準備が整っていません。'],
  ['overall maganda ang performance', '全体的に良い成績を収めています。'],
  ['overall kailangan pa ng improvement', '全体的にさらなる改善が必要です。'],
  ['maganda ang naging progress ngayong term', '今学期は素晴らしい進歩を見せてくれました。'],
  ['kailangan mag focus ngayong term', '今学期はより集中して取り組む必要があります。'],
  ['magandang katapusan ng term', '学期末に向けて良い締めくくりができています。'],
  ['excited para sa susunod na term', '次の学期もさらなる成長を期待しています。'],
  ['nosebleed sa japanese', '日本語の難しさに苦労していますが、継続が大切です。'],
  ['nakaka stress ang japanese', '日本語学習にストレスを感じているようですが、一歩ずつ進みましょう。'],
  ['nakakatuwa siya', '愛嬌があり、クラスに良い雰囲気をもたらしています。'],
  ['natututo na siya', '着実に学んでいます。'],
  ['hindi pa natututo', 'まだ十分な学習が見られません。'],
  ['okay siya', '概ね良い学習態度です。'],
  ['okay na okay siya', '非常に良い学習態度です。'],
  ['super galing', '非常に優れた実力です。'],
  ['solid ang japanese', '日本語の実力がしっかりしています。'],
  ['improving na siya', '着実に上達しています。'],
  ['hindi pa improving', 'まだ上達が見られません。'],
  ['needs to focus more', 'より集中して取り組む必要があります。'],
  ['needs more practice', 'より多くの練習が必要です。'],
  ['needs improvement sa speaking', 'スピーキングの改善が必要です。'],
  ['needs improvement sa writing', 'ライティングの改善が必要です。'],
  ['needs improvement sa reading', '読解力の改善が必要です。'],
  ['needs improvement sa listening', 'リスニング力の改善が必要です。'],
  ['good job sa kanya', 'よく頑張りました。'],
  ['well done siya', 'よくできました。'],
  ['excellent siya', '優秀な出来です。'],
  ['passing na siya', '合格ラインに達しています。'],
  ['borderline siya', '合格ラインぎりぎりのところにいます。'],
  ['failed siya', '残念ながら合格基準に達していません。'],
  ['may pag asa siya', 'まだ伸びしろがあります。'],
  ['walang pag asa', 'このままでは難しいため、真剣に取り組む必要があります。'],
  ['basta mag aral lang', 'しっかり学習に取り組めば必ず伸びます。'],
  ['kung mag aral lang sana', 'もっと学習に取り組んでほしいです。'],
  ['sana mag aral na ng husto', '今後は学習により真剣に取り組んでほしいです。'],
];

const matchTaglish = (text) => {
  const lower = text.toLowerCase().trim();
  const sorted = [...TAGLISH_MAP].sort((a, b) => b[0].length - a[0].length);
  for (const [phrase, japanese] of sorted) {
    if (lower.includes(phrase)) return japanese;
  }
  return null;
};

const PHRASE_MAP = [
  [/非常に良い(です)?/g, 'とても素晴らしい'],
  [/とても良い(です)?/g, 'たいへんよくできています'],
  [/良い(進歩|進捗)(です)?/g, '着実に成長しています'],
  [/良い(です|でした)?/g, 'よくできています'],
  [/素晴らしい(です)?/g, 'すばらしい頑張りです'],
  [/頑張って(いる|います)(ね|よ)?/g, '意欲的に取り組んでいます'],
  [/上手(です|でした)?/g, '上手にできています'],
  [/完璧(です)?/g, '申し分ありません'],
  [/もっと(勉強|練習)(する|して)(ください|下さい)?/g, '引き続き練習を重ねましょう'],
  [/勉強(する|して)(必要があります|ください)/g, '学習を継続することが大切です'],
  [/改善(する|して)(ください|必要があります)/g, 'さらなる向上を期待しています'],
  [/努力(する|して)(ください|必要があります)/g, '日々の努力を続けてください'],
  [/注意(する|して)(ください)?/g, '気をつけて取り組みましょう'],
  [/遅い(です)?/g, 'ペースアップを心がけましょう'],
  [/難しい(です|でした)?/g, '難しい部分もありますが、諦めずに続けましょう'],
  [/読む(こと|の)が(できます|上手です)/g, '読解力がついています'],
  [/聞く(こと|の)が(できます|上手です)/g, '聴解力が伸びています'],
  [/話す(こと|の)が(できます|上手です)/g, '会話力が向上しています'],
  [/書く(こと|の)が(できます|上手です)/g, '書く力がついています'],
  [/語彙(が少ない|を増やす必要があります)/g, '語彙力をさらに伸ばしましょう'],
  [/文法(が間違っている|を勉強する必要があります)/g, '文法の復習を続けましょう'],
  [/積極的(です|でした)?/g, '授業に積極的に参加しています'],
  [/消極的(です|でした)?/g, 'もう少し積極的に取り組みましょう'],
  [/真面目(です|でした)?/g, '真剣に取り組む姿勢が見られます'],
  [/怠け者(です)?/g, 'もう少し自主的な学習を心がけてほしいです'],
  [/集中(できない|していない)/g, '集中して授業に取り組みましょう'],
  [/集中(できる|しています)/g, '集中して学習に取り組んでいます'],
  [/進歩(しています|しました)/g, '着実に上達しています'],
  [/上達(しています|しました)/g, '確実に力がついています'],
  [/まだまだ(です)?/g, 'これからの更なる成長を期待しています'],
  [/もうすぐ(です)?/g, '目標まであと少しです'],
  [/次のレベル/g, '次のステップ'],
  [/する必要があります/g, 'することが大切です'],
  [/してください/g, 'するよう心がけましょう'],
  [/だと思います/g, 'と感じています'],
  [/ということです/g, 'と言えます'],
];

const postProcess = (text) => {
  let result = text;
  for (const [pattern, replacement] of PHRASE_MAP) {
    result = result.replace(pattern, replacement);
  }
  result = result.replace(/。+/g, '。').replace(/、+/g, '、').replace(/\s+/g, ' ').trim();
  if (result && !/[。！？]$/.test(result)) result += '。';
  return result;
};

app.post('/api/translate', async (req, res) => {
  try {
    const { text } = req.body;
    if (!text || !text.trim()) return res.json({ translation: '' });

    const taglishMatch = matchTaglish(text);
    if (taglishMatch) return res.json({ translation: taglishMatch });

    const tagalogWords = ['ang','ng','mga','na','sa','ay','niya','nila','kami','siya',
      'pero','kaya','dahil','para','mag','nag','yung','ung','din','rin',
      'talaga','medyo','masyado','sobra','kahit','dapat','pwede','hindi',
      'magaling','maayos','mahirap','madali','lagi','palagi','minsan'];
    const lower = text.toLowerCase();
    const isTagalog = tagalogWords.some(w => lower.split(/\s+/).includes(w));

    const mm = async (q, lp) => {
      const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(q)}&langpair=${lp}&de=sagebulacan@gmail.com`;
      const r = await fetch(url);
      const d = await r.json();
      return d.responseData?.translatedText || '';
    };

    let japanese = '';
    if (isTagalog) {
      const english = await mm(text, 'tl|en');
      japanese = await mm(english || text, 'en|ja');
    } else {
      japanese = await mm(text, 'en|ja');
    }

    res.json({ translation: postProcess(japanese) });
  } catch (err) {
    console.error('[translate] error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── FIX: patch empty Image documents that have no URL ───────────────────────
// Matches imageId in batch → finds its Cloudinary URL via publicId or deletes if unfixable
app.post('/api/admin/fix-empty-images', async (req, res) => {
  try {
    // Find all Image docs with no URL
    const emptyImgs = await Image.find({ $or: [{ url: null }, { url: { $exists: false } }, { url: '' }] });
    let fixed = 0, deleted = 0;
    for (const img of emptyImgs) {
      // Cannot recover without a publicId — delete the empty doc
      // and remove the reference from all batch items
      await Image.findByIdAndDelete(img._id);
      // Remove stale imageId references from all batch items
      const batches = await Batch.find({ 'students.categories.items.images': img._id.toString() });
      for (const batch of batches) {
        let changed = false;
        for (const student of batch.students) {
          for (const cat of student.categories) {
            for (const item of cat.items) {
              const before = item.images.length;
              item.images = item.images.filter(id => id !== img._id.toString());
              if (item.images.length !== before) changed = true;
            }
          }
        }
        if (changed) await batch.save();
      }
      deleted++;
    }
    res.json({ success: true, fixed, deleted, message: `Removed ${deleted} empty image records` });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── DIAGNOSTIC: check image format ──────────────────────────────────────────
app.get('/api/diagnostic/images', async (req, res) => {
  try {
    const batches = await Batch.find();
    const result = [];
    batches.forEach(batch => {
      batch.students.forEach(student => {
        student.categories.forEach(cat => {
          cat.items.forEach(item => {
            (item.images || []).forEach(img => {
              if (!img) return;
              result.push({
                batch: batch.name,
                student: student.name,
                format: img.startsWith('data:') ? 'base64'
                  : img.startsWith('http') ? 'url'
                  : 'unknown',
                preview: img.substring(0, 60)
              });
            });
          });
        });
      });
    });
    res.json({
      total: result.length,
      base64Count: result.filter(r => r.format === 'base64').length,
      urlCount: result.filter(r => r.format === 'url').length,
      samples: result.slice(0, 5)
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});