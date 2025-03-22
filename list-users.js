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

// Fix payment for users where webhook verification failed
async function fixPayment() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');
    
    // Array of users to fix with their subscription IDs
    const usersToFix = [
      { userId: "67df12120374fcf1760e393b", subscriptionId: "1067414" },
      { userId: "67df132e3836d964749a6496", subscriptionId: "1067415" }
    ];
    
    console.log(`Found ${usersToFix.length} users to fix...`);
    
    // Process each user
    for (const user of usersToFix) {
      console.log(`Processing user ID: ${user.userId}`);
      try {
        const result = await processSuccessfulPayment(user.userId, user.subscriptionId);
        console.log(`User updated successfully: ${result.email}`);
        console.log(`Payment status: ${result.isPay ? 'Paid' : 'Not Paid'}`);
        console.log(`Subscription status: ${result.subscriptionStatus}`);
      } catch (error) {
        console.error(`Error updating user ${user.userId}:`, error.message);
      }
      console.log('----------');
    }
    
    console.log('Payment fix completed!');
  } catch (error) {
    console.error('Error fixing payments:', error);
  } finally {
    await mongoose.connection.close();
    console.log('Database connection closed');
  }
}

// Run the function
// Comment/uncomment the function you want to run
listUsers();
// fixPayment(); 