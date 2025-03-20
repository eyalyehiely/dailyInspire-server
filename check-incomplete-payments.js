/**
 * Script to check for users who have attempted payments but haven't been properly marked as paid
 * 
 * Usage:
 * 1. Make sure MongoDB connection is configured in .env
 * 2. Run: node check-incomplete-payments.js
 */

const mongoose = require('mongoose');
const User = require('./models/User');
require('dotenv').config();

async function checkIncompletePayments() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');
    
    // Find users who have attempted checkout but aren't marked as paid
    const users = await User.find({
      'lastCheckoutAttempt.timestamp': { $exists: true, $ne: null },
      isPay: false
    });
    
    if (users.length === 0) {
      console.log('No users found with incomplete payments.');
      return;
    }
    
    console.log(`Found ${users.length} users with potential incomplete payments:`);
    
    // Display each user
    users.forEach((user, index) => {
      console.log(`\n[${index + 1}] User: ${user.first_name} ${user.last_name} (${user.email})`);
      console.log(`   ID: ${user._id.toString()}`);
      console.log(`   Last checkout attempt: ${user.lastCheckoutAttempt.timestamp}`);
      console.log(`   Checkout URL: ${user.lastCheckoutAttempt.url || 'Not recorded'}`);
      console.log(`   Subscription status: ${user.subscriptionStatus}`);
    });
    
    console.log('\nTo fix a user\'s payment status, run:');
    console.log('node fix-payment-status.js <user-email-or-id>');
    
  } catch (error) {
    console.error('Error checking incomplete payments:', error);
  } finally {
    await mongoose.connection.close();
    console.log('MongoDB connection closed');
  }
}

checkIncompletePayments(); 