/**
 * Script to list all users in the database
 * 
 * Usage:
 * 1. Make sure MongoDB connection is configured in .env
 * 2. Run: node list-users.js
 */

const mongoose = require('mongoose');
const User = require('./models/User');
require('dotenv').config();

async function listUsers() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');
    
    // Find all users
    const users = await User.find({}).sort({ createdAt: -1 }).limit(10);
    
    if (users.length === 0) {
      console.log('No users found in the database.');
      return;
    }
    
    console.log(`Found ${users.length} users:`);
    
    // Display each user
    users.forEach((user, index) => {
      console.log(`\n[${index + 1}] User: ${user.first_name} ${user.last_name} (${user.email})`);
      console.log(`   ID: ${user._id.toString()}`);
      console.log(`   Is Paid: ${user.isPay}`);
      console.log(`   Subscription Status: ${user.subscriptionStatus || 'none'}`);
      console.log(`   Registration Complete: ${user.isRegistrationComplete}`);
    });
    
  } catch (error) {
    console.error('Error listing users:', error);
  } finally {
    await mongoose.connection.close();
    console.log('MongoDB connection closed');
  }
}

listUsers(); 