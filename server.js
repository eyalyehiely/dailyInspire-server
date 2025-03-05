const express = require('express');
const cors = require('cors');
const app = express();
const port = 3000;
const quoteRoutes = require('./routes/quotes');
const authRoutes = require('./routes/auth');
const connectDB = require('./config/db');
const auth = require('./middleware/auth');

// Import and start the scheduler
const { startScheduler } = require('./controllers/scheduler');

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Call this before setting up routes
connectDB();

// Apply CORS middleware
app.use(cors({
  origin: ['http://localhost:3000', 'http://localhost:5173', 'https://dailyinspire.up.railway.app'],
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  credentials: true
}));

// Add this before your routes
app.use((req, res, next) => {
  if (req.path.includes('/api/auth/login')) {
    console.log('LOGIN REQUEST BODY:', JSON.stringify(req.body.username, null, 2));
    console.log('CONTENT TYPE:', req.get('Content-Type'));
  }
  next();
});

app.use('/api/quotes', quoteRoutes);
app.use('/api/auth', authRoutes);

// Protected route example
app.get('/api/profile', auth, (req, res) => {
  res.json({ user: req.user });
}); 



// Initialize the scheduler when the server starts
startScheduler();

app.listen(port, () => {
  console.log(`Server is running at http://localhost:${port}`);
});
