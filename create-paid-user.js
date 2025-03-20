/**
 * Script to create a new user with paid status
 * 
 * Usage:
 * 1. Make sure MongoDB connection is configured in .env
 * 2. Run: node create-paid-user.js
 */

const mongoose = require('mongoose');
const User = require('./models/User');
const bcrypt = require('bcryptjs');
require('dotenv').config();

async function createPaidUser() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');
    
    // Check if user already exists
    const existingUser = await User.findOne({ email: 'eyalwork0@gmail.com' });
    
    if (existingUser) {
      console.log('User already exists, updating payment status:');
      
      // Update existing user
      const updatedUser = await User.findByIdAndUpdate(
        existingUser._id,
        {
          isPay: true,
          isRegistrationComplete: true,
          quotesEnabled: true,
          subscriptionStatus: 'active',
          subscriptionId: `manual-creation-${Date.now()}`,
          paymentUpdatedAt: new Date()
        },
        { new: true }
      );
      
      console.log('Updated user successfully:');
      console.log({
        id: updatedUser._id.toString(),
        email: updatedUser.email,
        name: `${updatedUser.first_name} ${updatedUser.last_name}`,
        isPay: updatedUser.isPay,
        subscriptionStatus: updatedUser.subscriptionStatus
      });
      
      return;
    }
    
    // Create a new user
    const hashedPassword = await bcrypt.hash('password123', 10);
    
    const newUser = new User({
      email: 'eyalwork0@gmail.com',
      first_name: 'Eyal',
      last_name: 'Yehiely',
      password: hashedPassword,
      isPay: true,
      isRegistrationComplete: true,
      quotesEnabled: true,
      subscriptionStatus: 'active',
      subscriptionId: `manual-creation-${Date.now()}`,
      paymentUpdatedAt: new Date(),
      preferredTime: '09:00',
      timezone: 'Asia/Jerusalem'
    });
    
    await newUser.save();
    
    console.log('Created new paid user successfully:');
    console.log({
      id: newUser._id.toString(),
      email: newUser.email,
      name: `${newUser.first_name} ${newUser.last_name}`,
      isPay: newUser.isPay,
      subscriptionStatus: newUser.subscriptionStatus
    });
    
  } catch (error) {
    console.error('Error creating user:', error);
  } finally {
    await mongoose.connection.close();
    console.log('MongoDB connection closed');
  }
}

createPaidUser(); 