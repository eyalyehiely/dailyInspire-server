/**
 * Script to list all users in the database
 * 
 * Usage:
 * 1. Make sure MongoDB connection is configured in .env
 * 2. Run: node list-users.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const User = require('./models/User');
const { processSuccessfulPayment } = require('./controllers/payment-controller');

// Connect to MongoDB
const connectDB = async () => {
  try {
    const mongoURI = process.env.MONGODB_URI || 'mongodb://localhost:27017';
    const dbName = process.env.DB_NAME || 'my-quotes-app';
    const conn = await mongoose.connect(`${mongoURI}/${dbName}`);
    console.log(`MongoDB Connected: ${conn.connection.host}`);
  } catch (err) {
    console.error('Error connecting to MongoDB:', err.message);
    process.exit(1);
  }
};

// List all users
const listUsers = async () => {
  try {
    await connectDB();
    
    // Find all users
    const users = await User.find({}).select('_id email isPay isRegistrationComplete subscriptionStatus');
    
    console.log('\nUser List:');
    console.log('==========');
    
    users.forEach(user => {
      console.log(`ID: ${user._id}`);
      console.log(`Email: ${user.email}`);
      console.log(`Payment Status: ${user.isPay ? 'Paid' : 'Not Paid'}`);
      console.log(`Registration Complete: ${user.isRegistrationComplete ? 'Yes' : 'No'}`);
      console.log(`Subscription Status: ${user.subscriptionStatus || 'none'}`);
      console.log('----------');
    });
    
    console.log(`\nTotal users: ${users.length}`);
    
    // Close the connection
    await mongoose.connection.close();
    console.log('Database connection closed');
    
  } catch (err) {
    console.error('Error listing users:', err);
  }
};

// Run the function
listUsers();

async function fixPayment() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');
    
    const userId = "67df12120374fcf1760e393b";
    const subscriptionId = "1067414";
    
    const result = await processSuccessfulPayment(userId, subscriptionId);
    console.log('User updated:', result);
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await mongoose.connection.close();
  }
}

fixPayment(); 