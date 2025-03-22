/**
 * Script to fix payment issues on production server
 * 
 * This script updates the payment status for users who have paid
 * but weren't properly updated due to webhook signature verification failure.
 */

require('dotenv').config();
const mongoose = require('mongoose');
const User = require('./models/User');

async function fixProductionPayments() {
  try {
    // Connect to MongoDB using the production URI
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to production MongoDB database');
    
    // Array of users to fix with their subscription IDs from webhooks
    const usersToFix = [
      { userId: "67df12120374fcf1760e393b", subscriptionId: "1067414" },
      { userId: "67df132e3836d964749a6496", subscriptionId: "1067478" }
    ];
    
    for (const user of usersToFix) {
      console.log(`Processing user ID: ${user.userId}`);
      
      // Find user by ID
      const userRecord = await User.findById(user.userId);
      
      if (!userRecord) {
        console.error(`User not found with ID: ${user.userId}`);
        continue;
      }
      
      console.log(`Found user: ${userRecord.email}`);
      
      // Update user record directly
      const updatedUser = await User.findByIdAndUpdate(
        user.userId,
        { 
          isPay: true,
          isRegistrationComplete: true,
          quotesEnabled: true,
          subscriptionId: user.subscriptionId,
          subscriptionStatus: 'active',
          paymentUpdatedAt: new Date()
        },
        { new: true }
      );
      
      console.log(`User updated successfully: ${updatedUser.email}`);
      console.log(`Payment status: ${updatedUser.isPay ? 'Paid' : 'Not Paid'}`);
      console.log(`Subscription status: ${updatedUser.subscriptionStatus}`);
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
fixProductionPayments(); 