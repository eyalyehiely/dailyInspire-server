/**
 * Script to check user payment status in the database
 * 
 * This script:
 * 1. Connects to the MongoDB database
 * 2. Queries for all users
 * 3. Reports statistics on how many users have paid status
 * 4. Lists a few examples of paid and unpaid users
 * 
 * Usage:
 * 1. Make sure MongoDB connection is configured in .env
 * 2. Run: node check-user-payment-status.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const User = require('./models/User');

async function checkPaymentStatus() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');
    
    // Count total users
    const totalUsers = await User.countDocuments();
    console.log(`Total users in database: ${totalUsers}`);
    
    // Count paid users
    const paidUsers = await User.countDocuments({ isPay: true });
    console.log(`Paid users: ${paidUsers} (${((paidUsers / totalUsers) * 100).toFixed(2)}%)`);
    
    // Count users by subscription status
    const statusCounts = await User.aggregate([
      { $group: { _id: "$subscriptionStatus", count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]);
    
    console.log('\nUsers by subscription status:');
    statusCounts.forEach(status => {
      console.log(`- ${status._id || 'undefined'}: ${status.count} users`);
    });
    
    // Find users with inconsistent payment status
    const inconsistentUsers = await User.find({
      $or: [
        // Paid but no active subscription
        { isPay: true, subscriptionStatus: { $nin: ['active'] } },
        // Not paid but has active subscription
        { isPay: false, subscriptionStatus: 'active' }
      ]
    }).select('_id email isPay subscriptionStatus subscriptionId');
    
    if (inconsistentUsers.length > 0) {
      console.log('\nUsers with inconsistent payment status:');
      inconsistentUsers.forEach(user => {
        console.log(`- ${user.email}: isPay=${user.isPay}, status=${user.subscriptionStatus}, id=${user.subscriptionId}`);
      });
    } else {
      console.log('\nNo users with inconsistent payment status found.');
    }
    
    // Sample of paid users
    const paidUserSamples = await User.find({ isPay: true })
      .select('_id email isPay subscriptionStatus subscriptionId paymentUpdatedAt')
      .limit(5);
    
    console.log('\nSample of paid users:');
    paidUserSamples.forEach(user => {
      console.log(`- ${user.email}: status=${user.subscriptionStatus}, updated=${user.paymentUpdatedAt?.toISOString() || 'N/A'}`);
    });
    
    // Sample of unpaid users
    const unpaidUserSamples = await User.find({ isPay: false })
      .select('_id email isPay subscriptionStatus isRegistrationComplete')
      .limit(5);
    
    console.log('\nSample of unpaid users:');
    unpaidUserSamples.forEach(user => {
      console.log(`- ${user.email}: status=${user.subscriptionStatus}, registrationComplete=${user.isRegistrationComplete}`);
    });
    
    // Check for recently updated payment status
    const recentlyUpdated = await User.find({ 
      paymentUpdatedAt: { $gt: new Date(Date.now() - 24 * 60 * 60 * 1000) } // Last 24 hours
    }).select('_id email isPay subscriptionStatus paymentUpdatedAt');
    
    console.log('\nUsers with payment status updated in the last 24 hours:');
    if (recentlyUpdated.length > 0) {
      recentlyUpdated.forEach(user => {
        console.log(`- ${user.email}: isPay=${user.isPay}, updated=${user.paymentUpdatedAt?.toISOString()}`);
      });
    } else {
      console.log('No users with recently updated payment status found.');
    }
    
  } catch (error) {
    console.error('Error checking payment status:', error);
  } finally {
    await mongoose.connection.close();
    console.log('\nMongoDB connection closed');
  }
}

// Run the check
checkPaymentStatus(); 