console.log('MONGO_URI exists:', !!process.env.MONGO_URI);
console.log('PORT:', process.env.PORT);
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

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
    teacherId: { type: String, default: null },
    students: [{
      name: String,
      photo: String,
      status: { type: String, default: 'Regular' }, // 'Regular' or 'Selected'
      categories: [{
        name: String,
        items: [{
          name: String,
          date: String,
          score: Number,
          images: [String]
        }]
      }]
    }]
  });
const Batch = mongoose.model('Batch', batchSchema);

// 25002500 IMAGE MODEL & ROUTES 250025002500250025002500250025002500250025002500250025002500250025002500250025002500250025002500250025002500250025002500250025002500250025002500250025002500250025002500250025002500
const imageSchema = new mongoose.Schema({ url: String, publicId: String }, { timestamps: true });
const Image = mongoose.model('Image', imageSchema);
app.post('/api/images', async (req, res) => {
  try {
    const { url, publicId } = req.body;
    if (!url) return res.status(400).json({ error: 'url required' });
    const img = new Image({ url, publicId });
    await img.save();
    res.json({ _id: img._id, url });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
// POST bulk MUST be before GET /:id — otherwise Express matches "bulk" as an :id param
app.post('/api/images/bulk', async (req, res) => {
  try {
    const { ids } = req.body;
    if (!ids?.length) return res.json({});
    const imgs = await Image.find({ _id: { $in: ids } });
    const map = {};
    imgs.forEach(img => { map[img._id.toString()] = img.url; });
    res.json(map);
  } catch (err) { res.status(500).json({ error: err.message }); }
});
app.get('/api/images/:id', async (req, res) => {
  try {
    const img = await Image.findById(req.params.id);
    if (!img) return res.status(404).json({ error: 'Image not found' });
    res.json({ _id: img._id, url: img.url });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── TEACHER MODEL & ROUTES ───────────────────────────────────────────────────
const teacherSchema = new mongoose.Schema({
  name: String,
  emoji: { type: String, default: '👩‍🏫' },
});
const Teacher = mongoose.model('Teacher', teacherSchema);

app.get('/api/teachers', async (req, res) => {
  try { res.json(await Teacher.find()); } catch (err) { res.status(500).json({ error: err.message }); }
});
app.post('/api/teachers', async (req, res) => {
  try {
    const t = new Teacher({ name: req.body.name, emoji: req.body.emoji || '👩‍🏫' });
    await t.save(); res.json(t);
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
  try { const b = new Batch({ name: req.body.name, teacherId: req.body.teacherId || null, students: [] }); await b.save(); res.json(b); } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/batches/:batchId', async (req, res) => {
  try { await Batch.findByIdAndDelete(req.params.batchId); res.json({ success: true }); } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/batches/:batchId/students', async (req, res) => {
  try {
    const batch = await Batch.findById(req.params.batchId);
    batch.students.push({ name: req.body.name, photo: req.body.photo || null, status: req.body.status || 'Regular', categories: [] });
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
    student.categories.push({ name: req.body.name, items: [] });
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
    cat.items.push({ name: req.body.name, date: new Date().toISOString().split('T')[0], score: req.body.score, images: [] });
    await batch.save(); res.json(batch);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/batches/:batchId/students/:studentId/categories/:catId/items/:itemId', async (req, res) => {
  try {
    const batch = await Batch.findById(req.params.batchId);
    const student = batch.students.id(req.params.studentId);
    const cat = student.categories.id(req.params.catId);
    cat.items = cat.items.filter(i => i._id.toString() !== req.params.itemId);
    await batch.save(); res.json(batch);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.patch('/api/batches/:batchId/students/:studentId/categories/:catId/items/:itemId/image', async (req, res) => {
  try {
    const { url, publicId, image } = req.body;
    let imageRef;
    if (url) {
      const img = new Image({ url, publicId });
      await img.save();
      imageRef = img._id.toString();
    } else if (image) {
      imageRef = image;
    } else {
      return res.status(400).json({ error: 'url or image required' });
    }
    const batch = await Batch.findById(req.params.batchId);
    const student = batch.students.id(req.params.studentId);
    const cat = student.categories.id(req.params.catId);
    const item = cat.items.id(req.params.itemId);
    if (!item.images) item.images = [];
    item.images.push(imageRef);
    await batch.save();
    res.json({ success: true, imageId: imageRef });
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
      if (imageId && !imageId.startsWith('data:') && !imageId.startsWith('http')) {
        await Image.findByIdAndDelete(imageId).catch(() => {});
      }
      item.images.splice(index, 1);
    }
    await batch.save(); res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── ADMIN: CLOUDINARY STORAGE USAGE ──────────────────────────────────────────
app.get('/api/admin/storage-usage', async (req, res) => {
  try {
    const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
    const apiKey    = process.env.CLOUDINARY_API_KEY;
    const apiSecret = process.env.CLOUDINARY_API_SECRET;

    if (!cloudName || !apiKey || !apiSecret) {
      return res.status(500).json({ error: 'Cloudinary credentials not configured in server env.' });
    }

    const auth = Buffer.from(`${apiKey}:${apiSecret}`).toString('base64');

    const usageRes = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/usage`, {
      headers: { Authorization: `Basic ${auth}` }
    });
    const usage = await usageRes.json();

    if (usage.error) return res.status(500).json({ error: usage.error.message });

    res.json({
      used_bytes:  (usage.storage?.usage || 0),
      limit_bytes: (usage.storage?.limit || 25 * 1024 * 1024 * 1024),
      bandwidth:   { used: usage.bandwidth?.usage || 0, limit: usage.bandwidth?.limit || 0 },
      resources: {
        image_count: usage.resources?.image?.usage || 0,
        image_size:  usage.resources?.image?.usage_bytes || 0,
        raw_count:   usage.resources?.raw?.usage || 0,
        raw_size:    usage.resources?.raw?.usage_bytes || 0,
      },
      last_updated: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log('Server running on port ' + PORT));