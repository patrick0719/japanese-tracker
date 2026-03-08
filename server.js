const express = require('express');
const app = express();

// Fake data muna
let batches = [
  { id: 1, name: 'N5 Monday 6PM' },
  { id: 2, name: 'N4 Wednesday 7PM' }
];

// API route
app.get('/batches', (req, res) => {
  res.json(batches);
});

app.listen(5000, () => {
  console.log('Server ready at http://localhost:5000/batches');
});