console.log('MONGO_URI exists:', !!process.env.MONGO_URI);
console.log('PORT:', process.env.PORT);
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const crypto = require('crypto');
require('dotenv').config();

// ── ALLOWED ORIGINS (S1 fix — no more wildcard CORS) ─────────────────────────
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);
// Always allow the production frontend + localhost for dev
const DEFAULT_ORIGINS = [
  'https://japanese-tracker.vercel.app',
  'http://localhost:3000',
  'http://localhost:3001',
];
const allAllowedOrigins = [...new Set([...DEFAULT_ORIGINS, ...ALLOWED_ORIGINS])];

// ── RATE LIMITER (S2 fix — in-memory sliding window, no extra npm needed) ─────
const rateLimitStore = new Map();
function rateLimit({ windowMs = 60_000, max = 60, message = 'Too many requests, please try again later.' } = {}) {
  return (req, res, next) => {
    const ip = (req.headers['x-forwarded-for'] || req.ip || 'unknown').split(',')[0].trim();
    const now = Date.now();
    const windowStart = now - windowMs;
    const timestamps = (rateLimitStore.get(ip) || []).filter(t => t > windowStart);
    timestamps.push(now);
    rateLimitStore.set(ip, timestamps);
    if (timestamps.length > max) {
      return res.status(429).json({ error: message });
    }
    next();
  };
}
// Clean stale IPs every 5 min to prevent memory growth
setInterval(() => {
  const cutoff = Date.now() - 5 * 60_000;
  for (const [ip, times] of rateLimitStore.entries()) {
    if (!times.some(t => t > cutoff)) rateLimitStore.delete(ip);
  }
}, 5 * 60_000);

// ── SIMPLE ADMIN AUTH MIDDLEWARE (S4 fix) ─────────────────────────────────────
// Admin endpoints require X-Admin-Key header matching ADMIN_SECRET env var
const requireAdmin = (req, res, next) => {
  const adminSecret = (process.env.ADMIN_SECRET || '').trim();
  if (!adminSecret) {
    // If ADMIN_SECRET not set, block all admin access in production
    if (process.env.NODE_ENV === 'production') {
      return res.status(503).json({ error: 'Admin endpoints disabled: ADMIN_SECRET not configured.' });
    }
    return next(); // Allow in dev if not set
  }
  const key = (req.headers['x-admin-key'] || '').trim();
  if (!key || key !== adminSecret) {
    return res.status(401).json({ error: 'Unauthorized. Valid X-Admin-Key header required.' });
  }
  next();
};

// ── INPUT VALIDATION HELPERS (S3 fix) ────────────────────────────────────────
const isValidObjectId = (id) => /^[a-f\d]{24}$/i.test(id);
const sanitizeStr = (v, maxLen = 500) => (typeof v === 'string' ? v.trim().slice(0, maxLen) : '');
const sanitizeNum = (v, min = 0, max = 99999) => {
  const n = Number(v);
  return (!isNaN(n) && n >= min && n <= max) ? n : null;
};


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

// ── SERVER MONITOR ────────────────────────────────────────────────────────────
let requestCount = 0;
let requestCountThisHour = 0;
let hourStart = Date.now();
app.use((req, res, next) => {
  requestCount++;
  if (Date.now() - hourStart > 60 * 60 * 1000) { requestCountThisHour = 0; hourStart = Date.now(); }
  requestCountThisHour++;
  next();
});

// S1 fix: CORS restricted to known frontend origins (no more wildcard)
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, curl, server-to-server)
    if (!origin) return callback(null, true);
    if (allAllowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error(`CORS: origin '${origin}' not allowed`));
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Admin-Key'],
  credentials: true,
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
    scholarship: { type: String, default: 'no' },
    scholarshipType: { type: String, default: '' },
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
app.post("/api/images/bulk", rateLimit({ windowMs: 60_000, max: 60 }), async (req, res) => {
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
app.post('/api/images', rateLimit({ windowMs: 60_000, max: 30 }), async (req, res) => {
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

app.post('/api/batches', rateLimit({ windowMs: 60_000, max: 20 }), async (req, res) => {
  try {
    const name = sanitizeStr(req.body.name, 200);
    if (!name) return res.status(400).json({ error: 'Batch name is required' });
    const b = new Batch({
      name,
      name_ja: sanitizeStr(req.body.name_ja, 200),
      teacherId: req.body.teacherId || null,
      students: [],
    });
    await b.save();
    res.json(b);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.patch('/api/batches/:batchId', async (req, res) => {
  try {
    const batch = await Batch.findById(req.params.batchId);
    if (!batch) return res.status(404).json({ error: 'Batch not found' });
    if (req.body.name !== undefined) batch.name = req.body.name;
    if (req.body.name_ja !== undefined) batch.name_ja = req.body.name_ja;
    await batch.save();
    res.json(batch);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/batches/:batchId', async (req, res) => {
  try { await Batch.findByIdAndDelete(req.params.batchId); res.json({ success: true }); } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/batches/:batchId/students', async (req, res) => {
  try {
    // S3/B2 fix: null check + input validation
    const batch = await Batch.findById(req.params.batchId);
    if (!batch) return res.status(404).json({ error: 'Batch not found' });
    const name = sanitizeStr(req.body.name, 200);
    if (!name) return res.status(400).json({ error: 'Student name is required' });
    batch.students.push({
      name,
      photo: req.body.photo || null,
      status: ['Regular', 'Selected'].includes(req.body.status) ? req.body.status : 'Regular',
      companyName: sanitizeStr(req.body.companyName, 200),
      kumiai: sanitizeStr(req.body.kumiai, 100),
      scholarship: ['yes', 'no'].includes(req.body.scholarship) ? req.body.scholarship : 'no',
      scholarshipType: sanitizeStr(req.body.scholarshipType, 100),
      categories: [],
      evaluations: [],
    });
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
    if (req.body.scholarship !== undefined) student.scholarship = req.body.scholarship;
    if (req.body.scholarshipType !== undefined) student.scholarshipType = req.body.scholarshipType;
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

app.patch('/api/batches/:batchId/students/:studentId/categories/:catId', async (req, res) => {
  try {
    const batch = await Batch.findById(req.params.batchId);
    const student = batch.students.id(req.params.studentId);
    const cat = student.categories.id(req.params.catId);
    if (!cat) return res.status(404).json({ error: 'Category not found' });
    if (req.body.name !== undefined) cat.name = req.body.name;
    if (req.body.name_ja !== undefined) cat.name_ja = req.body.name_ja;
    await batch.save();
    res.json(batch);
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
    if (!batch) return res.status(404).json({ error: 'Batch not found' });
    const student = batch.students.id(req.params.studentId);
    if (!student) return res.status(404).json({ error: 'Student not found' });
    const cat = student.categories.id(req.params.catId);
    if (!cat) return res.status(404).json({ error: 'Category not found' });

    // B3/S3 fix: server-side score validation
    const name = sanitizeStr(req.body.name, 300);
    if (!name) return res.status(400).json({ error: 'Exam name is required' });
    const score = sanitizeNum(req.body.score, 0, 99999);
    const totalScore = sanitizeNum(req.body.totalScore, 1, 99999) || 100;
    if (score === null) return res.status(400).json({ error: 'Score must be a number between 0 and 99999' });
    if (score > totalScore) return res.status(400).json({ error: `Score (${score}) cannot exceed total score (${totalScore})` });

    // B4 fix: use provided date if valid, else today
    const dateInput = req.body.date;
    const date = (dateInput && /^\d{4}-\d{2}-\d{2}$/.test(dateInput))
      ? dateInput
      : new Date().toISOString().split('T')[0];

    const newItem = { name, name_ja: sanitizeStr(req.body.name_ja, 300), date, score, totalScore, images: [] };
    cat.items.push(newItem);
    await batch.save();
    res.json(cat.items[cat.items.length - 1]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.patch('/api/batches/:batchId/students/:studentId/categories/:catId/items/:itemId', async (req, res) => {
  try {
    const batch = await Batch.findById(req.params.batchId);
    if (!batch) return res.status(404).json({ error: 'Batch not found' });
    const student = batch.students.id(req.params.studentId);
    if (!student) return res.status(404).json({ error: 'Student not found' });
    const cat = student.categories.id(req.params.catId);
    if (!cat) return res.status(404).json({ error: 'Category not found' });
    const item = cat.items.id(req.params.itemId);
    if (!item) return res.status(404).json({ error: 'Item not found' });

    if (req.body.name !== undefined) item.name = sanitizeStr(req.body.name, 300);
    if (req.body.name_ja !== undefined) item.name_ja = sanitizeStr(req.body.name_ja, 300);
    // B3 fix: validate score on update too
    if (req.body.score !== undefined || req.body.totalScore !== undefined) {
      const score = sanitizeNum(req.body.score ?? item.score, 0, 99999);
      const totalScore = sanitizeNum(req.body.totalScore ?? item.totalScore, 1, 99999);
      if (score === null || totalScore === null) return res.status(400).json({ error: 'Invalid score values' });
      if (score > totalScore) return res.status(400).json({ error: `Score (${score}) cannot exceed total score (${totalScore})` });
      item.score = score;
      item.totalScore = totalScore;
    }
    if (req.body.date !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(req.body.date)) item.date = req.body.date;
    await batch.save();
    res.json(item);
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
app.post('/api/archive/migrate-base64', requireAdmin, async (req, res) => {
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


// ── SHARED ARCHIVE HELPER (Q1 fix — DRY) ─────────────────────────────────────
// Migrates images for a list of students between Cloudinary accounts
// direction: 'archive' = main → archive account, 'restore' = archive → main account
async function migrateStudentImages(student, direction) {
  let migrated = 0, skipped = 0, failed = 0;
  const errors = [];
  const archiveCloudName = process.env.CLOUDINARY_ARCHIVE_CLOUD_NAME || '';

  for (const cat of student.categories) {
    for (const item of cat.items) {
      for (const imgRef of (item.images || [])) {
        if (!isValidObjectId(imgRef)) { skipped++; continue; }
        const imgDoc = await Image.findById(imgRef);
        if (!imgDoc?.url) { skipped++; continue; }

        const isInArchive = archiveCloudName && imgDoc.url.includes(archiveCloudName);
        // Skip if already in the right place
        if (direction === 'archive' && isInArchive) { skipped++; continue; }
        if (direction === 'restore' && !isInArchive) { skipped++; continue; }

        try {
          const fetchRes = await fetch(imgDoc.url);
          const arrayBuffer = await fetchRes.arrayBuffer();
          const base64 = Buffer.from(arrayBuffer).toString('base64');
          const mimeType = fetchRes.headers.get('content-type') || 'image/jpeg';
          const dataUrl = `data:${mimeType};base64,${base64}`;

          const { url, publicId } = direction === 'archive'
            ? await cloudinaryArchiveUpload(dataUrl)
            : await cloudinaryUpload(dataUrl);

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
  return { migrated, skipped, failed, errors };
}

// ── ARCHIVE BATCH: move all images to archive Cloudinary ─────────────────────
app.post('/api/archive/batch/:batchId', requireAdmin, async (req, res) => {
  try {
    const batch = await Batch.findById(req.params.batchId);
    if (!batch) return res.status(404).json({ error: 'Batch not found' });
    let migrated = 0, skipped = 0, failed = 0, errors = [];
    for (const student of batch.students) {
      const r = await migrateStudentImages(student, 'archive');
      migrated += r.migrated; skipped += r.skipped; failed += r.failed;
      errors = errors.concat(r.errors.map(e => ({ student: student.name, ...e })));
    }
    res.json({ success: true, batch: batch.name, migrated, skipped, failed, errors });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── CLEANUP: delete empty Image documents ────────────────────────────────────
app.delete('/api/diagnostic/cleanup-empty', requireAdmin, async (req, res) => {
  try {
    const result = await Image.deleteMany({ url: { $exists: false } });
    res.json({ deleted: result.deletedCount });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── ARCHIVE STUDENT: move one student's images to archive Cloudinary ──────────
app.post('/api/archive/student/:batchId/:studentId', requireAdmin, async (req, res) => {
  try {
    const batch = await Batch.findById(req.params.batchId);
    if (!batch) return res.status(404).json({ error: 'Batch not found' });
    const student = batch.students.id(req.params.studentId);
    if (!student) return res.status(404).json({ error: 'Student not found' });
    const result = await migrateStudentImages(student, 'archive');
    res.json({ success: true, student: student.name, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── RESTORE STUDENT: move images back to main Cloudinary ─────────────────────
app.post('/api/archive/restore/:batchId/:studentId', requireAdmin, async (req, res) => {
  try {
    const batch = await Batch.findById(req.params.batchId);
    if (!batch) return res.status(404).json({ error: 'Batch not found' });
    const student = batch.students.id(req.params.studentId);
    if (!student) return res.status(404).json({ error: 'Student not found' });
    const result = await migrateStudentImages(student, 'restore');
    res.json({ success: true, student: student.name, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PERMANENT DELETE STUDENT: delete all images + student record ──────────────
app.delete('/api/archive/permanent/:batchId/:studentId', requireAdmin, async (req, res) => {
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
app.get('/api/admin/storage-usage', requireAdmin, async (req, res) => {
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
app.get('/api/admin/server-stats', requireAdmin, async (req, res) => {
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

    // ── Railway: walang Instance Hours limit — always running ─────────────────
    // Expose Railway environment info from env vars (auto-set by Railway)
    const railway = {
      platform: 'Railway',
      environment: process.env.RAILWAY_ENVIRONMENT_NAME || process.env.NODE_ENV || 'production',
      region: process.env.RAILWAY_REGION || 'asia-southeast1',
      serviceName: process.env.RAILWAY_SERVICE_NAME || 'japanese-tracker',
      deploymentId: process.env.RAILWAY_DEPLOYMENT_ID || null,
      replicaId: process.env.RAILWAY_REPLICA_ID || null,
      // Railway Hobby plan: always on, no instance hour limits
      alwaysOn: true,
      plan: 'Hobby',
    };

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
      railway,
      database: {
        status: dbStateLabel,
        batches: batchCount,
        images: imageCount,
        teachers: teacherCount,
      },
      node: {
        version: process.version,
        platform: process.platform,
        env: process.env.NODE_ENV || 'production',
      },
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
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

app.post('/api/translate', rateLimit({ windowMs: 60_000, max: 10, message: 'Translation rate limit exceeded. Please wait a moment.' }), async (req, res) => {
  try {
    const raw = req.body.text;
    if (!raw || typeof raw !== 'string') return res.json({ translation: '' });
    const text = raw.trim().slice(0, 1000); // S3: cap at 1000 chars
    if (!text) return res.json({ translation: '' });

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
app.post('/api/admin/fix-empty-images', requireAdmin, async (req, res) => {
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
app.get('/api/diagnostic/images', requireAdmin, async (req, res) => {
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

// ── PUSH NOTIFICATION (FCM) ───────────────────────────────────────────────────
// Requires these Railway environment variables:
//   FCM_PROJECT_ID     — from Firebase service account JSON
//   FCM_CLIENT_EMAIL   — from Firebase service account JSON
//   FCM_PRIVATE_KEY    — from Firebase service account JSON (keep newlines as \n)

const pushTokenSchema = new mongoose.Schema({
  token:       { type: String, required: true, unique: true },
  role:        { type: String, default: 'admin' },   // 'admin' or teacher role
  teacherId:   { type: String, default: null },
  teacherName: { type: String, default: '' },
  updatedAt:   { type: Date, default: Date.now },
});
const PushToken = mongoose.model('PushToken', pushTokenSchema);

// POST /api/push/register — save or update FCM token from a logged-in device
app.post('/api/push/register', rateLimit({ windowMs: 60_000, max: 20 }), async (req, res) => {
  try {
    const { token, role, teacherId, teacherName } = req.body;
    if (!token) return res.status(400).json({ error: 'token required' });

    // Upsert — one record per token
    await PushToken.findOneAndUpdate(
      { token },
      { role, teacherId, teacherName: sanitizeStr(teacherName, 100), updatedAt: new Date() },
      { upsert: true, new: true }
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── FCM HTTP v1 send helper ───────────────────────────────────────────────────
let _fcmAccessToken = null;
let _fcmTokenExpiry = 0;

async function getFcmAccessToken() {
  // Return cached token if still valid (expiry minus 60s buffer)
  if (_fcmAccessToken && Date.now() < _fcmTokenExpiry - 60_000) return _fcmAccessToken;

  const projectId   = process.env.FCM_PROJECT_ID;
  const clientEmail = process.env.FCM_CLIENT_EMAIL;
  const privateKey  = (process.env.FCM_PRIVATE_KEY || '').replace(/\\n/g, '\n');

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error('FCM environment variables not configured (FCM_PROJECT_ID, FCM_CLIENT_EMAIL, FCM_PRIVATE_KEY)');
  }

  // Build JWT for Google OAuth2
  const now = Math.floor(Date.now() / 1000);
  const header  = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iss:   clientEmail,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud:   'https://oauth2.googleapis.com/token',
    iat:   now,
    exp:   now + 3600,
  })).toString('base64url');

  const toSign = `${header}.${payload}`;
  const sign   = crypto.createSign('RSA-SHA256');
  sign.update(toSign);
  const signature = sign.sign(privateKey, 'base64url');
  const jwt = `${toSign}.${signature}`;

  // Exchange JWT for access token
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion:  jwt,
    }),
  });
  const tokenData = await tokenRes.json();
  if (!tokenData.access_token) throw new Error('Failed to get FCM access token: ' + JSON.stringify(tokenData));

  _fcmAccessToken = tokenData.access_token;
  _fcmTokenExpiry = Date.now() + (tokenData.expires_in || 3600) * 1000;
  return _fcmAccessToken;
}

async function sendFcmNotification(token, title, body) {
  const projectId   = process.env.FCM_PROJECT_ID;
  const accessToken = await getFcmAccessToken();

  const res = await fetch(
    `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`,
    {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        message: {
          token,
          notification: { title, body },
          webpush: {
            notification: {
              icon:    '/logo192.png',
              badge:   '/logo192.png',
              vibrate: [200, 100, 200],
              tag:     'sage-reminder',
              renotify: true,
              actions: [
                { action: 'open',    title: '📂 Buksan ang App' },
                { action: 'dismiss', title: 'Dismiss' },
              ],
            },
          },
        },
      }),
    }
  );
  return res.json();
}

// ── SMART REMINDER CRON — runs every day at 8:00 AM Philippine Time (UTC+8) ──
// Checks on 15th and 30th of the month which students have no exam in 30 days
// and sends push notifications to all registered teachers/admins.
// GET /api/push/test — manually trigger a test notification to all registered devices
// Usage: open https://japanese-tracker-production.up.railway.app/api/push/test in browser
app.get('/api/push/test', async (req, res) => {
  try {
    console.log('[SAGE Test] FCM_PROJECT_ID:', process.env.FCM_PROJECT_ID);
    console.log('[SAGE Test] FCM_CLIENT_EMAIL:', process.env.FCM_CLIENT_EMAIL);
    console.log('[SAGE Test] KEY starts:', (process.env.FCM_PRIVATE_KEY || '').substring(0, 40));

    const tokens = await PushToken.find();
    if (tokens.length === 0) {
      return res.json({ success: false, message: 'Walang registered tokens.' });
    }

    const title = '🔔 SAGE Test Notification';
    const body  = 'Gumagana ang push notifications! ✅';
    let sent = 0, failed = 0;

    for (const doc of tokens) {
      try {
        const result = await sendFcmNotification(doc.token, title, body);
        console.log('[SAGE Test] FCM result:', JSON.stringify(result));
        if (result.error) { failed++; } else { sent++; }
      } catch (err) {
        console.log('[SAGE Test] Send error:', err.message);
        failed++;
      }
    }

    res.json({ success: true, sent, failed, totalTokens: tokens.length });
  } catch (err) {
    console.log('[SAGE Test] Top error:', err.message);
    res.status(500).json({ error: err.message });
  }
});
function scheduleDailyReminder() {
  const checkAndSend = async () => {
    const now = new Date();
    // Philippine time = UTC + 8
    const phHour = (now.getUTCHours() + 8) % 24;
    const phDay  = new Date(now.getTime() + 8 * 60 * 60 * 1000).getUTCDate();

    // Only run at 8 AM Philippine time, on the 15th or 30th of the month
    if (phHour !== 8) return;
    if (phDay !== 15 && phDay !== 30) return;

    console.log(`[SAGE Cron] Running smart reminder check — ${now.toISOString()}`);

    try {
      const cutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      const batches = await Batch.find();

      const flagged = []; // { studentName, batchName, daysSince }
      batches.forEach(batch => {
        batch.students
          .filter(s => !s.isArchived)
          .forEach(student => {
            let latestExamDate = null;
            (student.categories || []).forEach(cat => {
              (cat.items || []).forEach(item => {
                if (item.date) {
                  const d = new Date(item.date);
                  if (!latestExamDate || d > latestExamDate) latestExamDate = d;
                }
              });
            });

            const hasNoRecentExam = !latestExamDate || latestExamDate < cutoff;
            if (hasNoRecentExam) {
              const daysSince = latestExamDate
                ? Math.floor((now - latestExamDate) / (1000 * 60 * 60 * 24))
                : null;
              flagged.push({
                studentName: student.name,
                batchName:   batch.name,
                daysSince,
              });
            }
          });
      });

      if (flagged.length === 0) {
        console.log('[SAGE Cron] No students to flag — no notifications sent.');
        return;
      }

      // Build notification message
      const title = `🔔 SAGE Reminder — ${flagged.length} student${flagged.length !== 1 ? 's' : ''} need attention`;
      const preview = flagged.slice(0, 3).map(f =>
        `${f.studentName} (${f.batchName})${f.daysSince ? ` — ${f.daysSince}d` : ' — no exam yet'}`
      ).join('\n');
      const body = preview + (flagged.length > 3 ? `\n+${flagged.length - 3} more` : '');

      // Fetch all registered tokens (teachers + admins only — viewers never register)
      const tokens = await PushToken.find();
      console.log(`[SAGE Cron] Sending to ${tokens.length} device(s) — ${flagged.length} student(s) flagged`);

      let sent = 0, failed = 0;
      const staleTokens = [];

      for (const doc of tokens) {
        try {
          const result = await sendFcmNotification(doc.token, title, body);
          if (result.error) {
            // Token no longer valid — remove it
            if (
              result.error.status === 'UNREGISTERED' ||
              result.error.status === 'INVALID_ARGUMENT'
            ) {
              staleTokens.push(doc._id);
            }
            console.warn(`[SAGE Cron] FCM error for ${doc.teacherName}:`, result.error);
            failed++;
          } else {
            sent++;
          }
        } catch (err) {
          console.error(`[SAGE Cron] Send error for ${doc.teacherName}:`, err.message);
          failed++;
        }
      }

      // Clean up stale tokens
      if (staleTokens.length > 0) {
        await PushToken.deleteMany({ _id: { $in: staleTokens } });
        console.log(`[SAGE Cron] Removed ${staleTokens.length} stale token(s)`);
      }

      console.log(`[SAGE Cron] Done — sent: ${sent}, failed: ${failed}`);
    } catch (err) {
      console.error('[SAGE Cron] Error:', err.message);
    }
  };

  // Check every hour — the function itself guards day/time
  setInterval(checkAndSend, 60 * 60 * 1000);

  // Also run once on startup (harmless if not the right time)
  checkAndSend();
}

scheduleDailyReminder();

// ── SERVER START ─────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
