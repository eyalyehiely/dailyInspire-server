/**
 * Test script for payment flow
 * 
 * This script tests:
 * 1. Creating a test user
 * 2. Directly calling the processSuccessfulPayment function
 * 3. Verifying the user is properly updated in the database after payment
 * 
 * Usage:
 * 1. Make sure MongoDB connection is configured in .env
 * 2. Run: node test-payment-flow.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const User = require('./models/User');
const bcrypt = require('bcryptjs');
const { processSuccessfulPayment } = require('./controllers/payment-controller');

/**
 * Creates a test user in the database
 */
async function createTestUser() {
  try {
    // Create random email to avoid conflicts
    const randomId = Math.floor(Math.random() * 10000);
    const email = `test-user-${randomId}@example.com`;
    
    // Create a new user with unpaid status
    const hashedPassword = await bcrypt.hash('password123', 10);
    
    const testUser = new User({
      email: email,
      first_name: 'Test',
      last_name: 'User',
      password: hashedPassword,
      isPay: false,
      isRegistrationComplete: false,
      quotesEnabled: false,
      subscriptionStatus: 'none',
    });
    
    await testUser.save();
    
    console.log('Created test user:');
    console.log({
      id: testUser._id.toString(),
      email: testUser.email,
      isPay: testUser.isPay,
      isRegistrationComplete: testUser.isRegistrationComplete
    });
    
    return testUser;
  } catch (error) {
    console.error('Error creating test user:', error);
    throw error;
  }
}

/**
 * Directly processes a payment for the user
 */
async function directlyProcessPayment(userId) {
  try {
    console.log(`Directly processing payment for user: ${userId}`);
    
    // Generate a test subscription ID
    const subscriptionId = `test-subscription-${Date.now()}`;
    
    // Directly call the payment processing function
    const updatedUser = await processSuccessfulPayment(userId, subscriptionId);
    
    console.log('Payment processed successfully');
    return { subscriptionId, updatedUser };
  } catch (error) {
    console.error('Error processing payment:', error);
    throw error;
  }
}

/**
 * Verifies that the user was properly updated after payment
 */
async function verifyUserUpdated(userId, subscriptionId) {
  try {
    // Get the updated user from the database
    const updatedUser = await User.findById(userId);
    
    if (!updatedUser) {
      throw new Error(`User not found with ID: ${userId}`);
    }
    
    console.log('Updated user after payment:');
    console.log({
      id: updatedUser._id.toString(),
      email: updatedUser.email,
      isPay: updatedUser.isPay,
      isRegistrationComplete: updatedUser.isRegistrationComplete,
      subscriptionStatus: updatedUser.subscriptionStatus,
      subscriptionId: updatedUser.subscriptionId,
      quotesEnabled: updatedUser.quotesEnabled
    });
    
    // Verify all expected fields were updated
    const success = 
      updatedUser.isPay === true &&
      updatedUser.isRegistrationComplete === true &&
      updatedUser.subscriptionStatus === 'active' &&
      updatedUser.subscriptionId === subscriptionId &&
      updatedUser.quotesEnabled === true;
    
    if (success) {
      console.log('✅ TEST PASSED: User was successfully updated after payment');
    } else {
      console.log('❌ TEST FAILED: User was not properly updated after payment');
      console.log('Expected:', {
        isPay: true,
        isRegistrationComplete: true,
        subscriptionStatus: 'active',
        subscriptionId: subscriptionId,
        quotesEnabled: true
      });
      console.log('Actual:', {
        isPay: updatedUser.isPay,
        isRegistrationComplete: updatedUser.isRegistrationComplete,
        subscriptionStatus: updatedUser.subscriptionStatus,
        subscriptionId: updatedUser.subscriptionId,
        quotesEnabled: updatedUser.quotesEnabled
      });
    }
    
    return { success, user: updatedUser };
  } catch (error) {
    console.error('Error verifying user update:', error);
    throw error;
  }
}

/**
 * Main test function
 */
async function testPaymentFlow() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');
    
    // Step 1: Create a test user
    const testUser = await createTestUser();
    const userId = testUser._id.toString();
    
    // Step 2: Directly process payment for the user
    const { subscriptionId } = await directlyProcessPayment(userId);
    
    // Step 3: Verify the user is properly updated in the database
    const result = await verifyUserUpdated(userId, subscriptionId);
    
    // Clean up - remove test user
    await User.findByIdAndDelete(userId);
    console.log('Test user deleted');
    
    return result;
  } catch (error) {
    console.error('Error in payment flow test:', error);
  } finally {
    await mongoose.connection.close();
    console.log('MongoDB connection closed');
  }
}

// Run the test
testPaymentFlow(); 