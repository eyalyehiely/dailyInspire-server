// Load environment variables first, before any other code
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const app = express();
const port = 3000;
const quoteRoutes = require('./routes/quotes');
const authRoutes = require('./routes/auth');
const paymentRoutes = require('./routes/payments');
const connectDB = require('./config/db');
const auth = require('./middleware/auth');
const completeRegistration = require('./middleware/completeRegistration');
const passwordResetRoutes = require('./routes/password-reset');
const contactRoutes = require('./routes/contact');
const testingRoutes = require('./routes/testing');
const rawBody = require('./middleware/raw-body');
const webhookRoutes = require('./routes/webhook');
// Import and start the scheduler
const { startScheduler } = require('./controllers/scheduler');

// Apply CORS middleware
app.use(cors({
  origin: ['http://localhost:3000', 'http://localhost:5173', 'https://dailyinspire.up.railway.app','https://app.dailyinspire.xyz'],
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  credentials: true
}));

// Add raw body middleware for webhook verification
app.use('/api/webhook', rawBody);

app.use(express.json());

// Call this before setting up routes
connectDB();

// Add this before your routes
app.use((req, res, next) => {
  if (req.path.includes('/api/auth/login')) {
    console.log('LOGIN REQUEST BODY:', JSON.stringify(req.body.username, null, 2));
    console.log('CONTENT TYPE:', req.get('Content-Type'));
  }
  next();
});

// Payment routes don't require complete registration since they're used to complete it
app.use('/api/payments', paymentRoutes);

// Routes that don't require full authentication
app.use('/api/quotes', quoteRoutes);
app.use('/api/auth', authRoutes);
app.use('/api', passwordResetRoutes);
app.use('/api/contact', contactRoutes);
app.use('/api/testing', testingRoutes);
app.use('/api', webhookRoutes);
// Protected route example - requires both authentication and complete registration
app.get('/api/profile', auth, completeRegistration, (req, res) => {
  res.json({ user: req.user });
}); 

// Initialize the scheduler when the server starts
startScheduler();

// Start the server
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
  
});

