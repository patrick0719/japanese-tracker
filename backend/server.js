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
      status: { type: String, default: 'Regular' },
      companyName: { type: String, default: '' },
      categories: [{
        name: String,
        items: [{
          name: String,
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

// ── TEACHER MODEL & ROUTES ───────────────────────────────────────────────────
const teacherSchema = new mongoose.Schema({
  name: String,
  emoji: { type: String, default: '👩‍🏫' },
  signature: { type: String, default: null }, // base64 image
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
    batch.students.push({ name: req.body.name, photo: req.body.photo || null, status: req.body.status || 'Regular', companyName: req.body.companyName || '', categories: [], evaluations: [] });
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
    const newItem = { name: req.body.name, date: new Date().toISOString().split('T')[0], score: req.body.score, totalScore: req.body.totalScore || 100, images: [] };
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
    const batch = await Batch.findById(req.params.batchId);
    const student = batch.students.id(req.params.studentId);
    const cat = student.categories.id(req.params.catId);
    const item = cat.items.id(req.params.itemId);
    if (!item.images) item.images = [];
    item.images.push(req.body.image);
    await batch.save(); res.json(batch);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.patch('/api/batches/:batchId/students/:studentId/categories/:catId/items/:itemId/remove-image', async (req, res) => {
  try {
    const batch = await Batch.findById(req.params.batchId);
    const student = batch.students.id(req.params.studentId);
    const cat = student.categories.id(req.params.catId);
    const item = cat.items.id(req.params.itemId);
    const { index } = req.body;
    if (item.images && item.images[index] !== undefined) item.images.splice(index, 1);
    await batch.save(); res.json(batch);
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

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log('Server running on port ' + PORT));

// ── TRANSLATE ROUTE (MyMemory + post-processing) ─────────────────────────────
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

    const myMemory = async (q, langPair) => {
      const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(q)}&langpair=${langPair}&de=sagebulacan@gmail.com`;
      const r = await fetch(url);
      const d = await r.json();
      return d.responseData?.translatedText || '';
    };

    const tagalogWords = ['ang','ng','mga','na','sa','ay','niya','nila','kami','siya',
      'pero','kaya','dahil','para','mag','nag','yung','ung','din','rin',
      'talaga','medyo','masyado','sobra','kahit','dapat','pwede','hindi',
      'magaling','maayos','mahirap','madali','lagi','palagi','minsan'];
    const lower = text.toLowerCase();
    const isTagalog = tagalogWords.some(w => lower.split(/\s+/).includes(w));

    let japanese = '';
    if (isTagalog) {
      const english = await myMemory(text, 'tl|en');
      japanese = await myMemory(english || text, 'en|ja');
    } else {
      japanese = await myMemory(text, 'en|ja');
    }

    const refined = postProcess(japanese);
    res.json({ translation: refined });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});