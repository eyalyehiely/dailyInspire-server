const mongoose = require('mongoose');
const User = require('./models/User');
require('dotenv').config();

// Get user identifier from command line arguments (email or ID)
const userIdentifier = process.argv[2];

if (!userIdentifier) {
  console.error('Please provide a user email or ID as argument');
  console.log('Usage: node fix-payment-status.js <email-or-id>');
  process.exit(1);
}

async function fixUserPaymentStatus() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');
    
    // Try to find user by email first
    let user = await User.findOne({ email: userIdentifier });
    
    // If not found by email, try by ID
    if (!user && mongoose.Types.ObjectId.isValid(userIdentifier)) {
      user = await User.findById(userIdentifier);
    }
    
    if (!user) {
      console.error(`User not found with identifier: ${userIdentifier}`);
      process.exit(1);
    }
    
    console.log('Found user:');
    console.log({
      id: user._id.toString(),
      email: user.email,
      name: `${user.first_name} ${user.last_name}`,
      isPay: user.isPay,
      subscriptionStatus: user.subscriptionStatus || 'none'
    });
    
    // Get confirmation before proceeding
    console.log('\nUpdating payment status to PAID...');
    
    // Update user payment status
    user.isPay = true;
    user.isRegistrationComplete = true;
    user.quotesEnabled = true;
    user.subscriptionStatus = 'active';
    user.subscriptionId = `manual-fix-${Date.now()}`;
    user.paymentUpdatedAt = new Date();
    
    await user.save();
    
    console.log('\nPayment status updated successfully!');
    console.log({
      id: user._id.toString(),
      email: user.email,
      name: `${user.first_name} ${user.last_name}`,
      isPay: user.isPay,
      subscriptionStatus: user.subscriptionStatus
    });
    
  } catch (error) {
    console.error('Error fixing payment status:', error);
  } finally {
    await mongoose.connection.close();
    console.log('MongoDB connection closed');
  }
}

fixUserPaymentStatus(); 