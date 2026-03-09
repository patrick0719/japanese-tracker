const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

const app = express();

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
  students: [{ name: String, photo: String, exams: [{ name: String, date: String, score: Number, image: String }] }]
});
const Batch = mongoose.model('Batch', batchSchema);

app.get('/api/batches', async (req, res) => {
  try { res.json(await Batch.find()); } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/batches', async (req, res) => {
  try { const b = new Batch({ name: req.body.name, students: [] }); await b.save(); res.json(b); } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/batches/:batchId', async (req, res) => {
  try { await Batch.findByIdAndDelete(req.params.batchId); res.json({ success: true }); } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/batches/:batchId/students', async (req, res) => {
  try {
    const batch = await Batch.findById(req.params.batchId);
    batch.students.push({ name: req.body.name, photo: req.body.photo || null, exams: [] });
    await batch.save();
    res.json(batch);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/batches/:batchId/students/:studentId', async (req, res) => {
  try {
    const batch = await Batch.findById(req.params.batchId);
    batch.students = batch.students.filter(s => s._id.toString() !== req.params.studentId);
    await batch.save(); res.json(batch);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/batches/:batchId/students/:studentId/exams', async (req, res) => {
  try {
    const batch = await Batch.findById(req.params.batchId);
    const student = batch.students.id(req.params.studentId);
    student.exams.push({ name: req.body.name, date: new Date().toISOString().split('T')[0], score: req.body.score, image: null });
    await batch.save(); res.json(batch);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.patch('/api/batches/:batchId/students/:studentId/exams/:examId/image', async (req, res) => {
  try {
    const batch = await Batch.findById(req.params.batchId);
    const student = batch.students.id(req.params.studentId);
    const exam = student.exams.id(req.params.examId);
    exam.image = req.body.image;
    await batch.save(); res.json(batch);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/batches/:batchId/students/:studentId/exams/:examId', async (req, res) => {
  try {
    const batch = await Batch.findById(req.params.batchId);
    const student = batch.students.id(req.params.studentId);
    student.exams = student.exams.filter(e => e._id.toString() !== req.params.examId);
    await batch.save(); res.json(batch);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log('Server running on port ' + PORT));
