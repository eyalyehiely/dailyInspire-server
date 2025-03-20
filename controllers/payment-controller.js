const axios = require('axios');
const User = require('../models/User');
const crypto = require('crypto');
const nodemailer = require('nodemailer');

// Initialize LemonSqueezy API client
const lemonSqueezyApi = axios.create({
  baseURL: 'https://api.lemonsqueezy.com/v1',
  headers: {
    'Authorization': `Bearer ${process.env.LEMON_SQUEEZY_API_KEY}`,
    'Accept': 'application/json',
    'Content-Type': 'application/json'
  }
});

// Verify a webhook signature from LemonSqueezy
const verifyWebhookSignature = (signature, body) => {
  console.log('Verifying webhook signature');
  
  if (!process.env.LEMON_SQUEEZY_WEBHOOK_SECRET) {
    console.error('LEMON_SQUEEZY_WEBHOOK_SECRET is not set in environment variables');
    return false;
  }
  
  if (!signature) {
    console.error('No signature provided for verification');
    return false;
  }
  
  try {
    // Convert body to string if it's an object
    const bodyString = typeof body === 'string' ? body : JSON.stringify(body);
    
    // Create HMAC using the webhook secret
    const hmac = crypto.createHmac('sha256', process.env.LEMON_SQUEEZY_WEBHOOK_SECRET);
    const calculatedSignature = hmac.update(bodyString).digest('hex');
    
    console.log('Webhook signature verification:');
    console.log(`Provided signature: ${signature}`);
    console.log(`Calculated signature: ${calculatedSignature}`);
    
    // Do a simple string comparison first (safer)
    if (calculatedSignature === signature) {
      console.log('Signature verified (string comparison)');
      return true;
    }
    
    // Then try the timing-safe comparison as backup
    try {
      // Compare the calculated signature with the one provided in the request
      const isValid = crypto.timingSafeEqual(
        Buffer.from(calculatedSignature, 'hex'),
        Buffer.from(signature, 'hex')
      );
      
      console.log(`Signature verification result: ${isValid ? 'valid' : 'invalid'}`);
      return isValid;
    } catch (cryptoError) {
      console.error('Error in timing-safe comparison:', cryptoError);
      // Fall back to string comparison if timingSafeEqual fails
      return calculatedSignature === signature;
    }
  } catch (error) {
    console.error('Error verifying webhook signature:', error);
    console.error('Error stack:', error.stack);
    return false;
  }
};

// Process a successful payment and mark registration as complete
const processSuccessfulPayment = async (userId, subscriptionId = null) => {
  try {
    console.log(`Processing payment for user: ${userId}`);
    console.log(`Subscription ID: ${subscriptionId || 'unknown'}`);
    
    if (!userId) {
      throw new Error('Missing user ID');
    }
    
    // Validate the user ID is a valid MongoDB ID
    const mongoose = require('mongoose');
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      throw new Error(`Invalid user ID format: ${userId}`);
    }
    
    // Find user first to verify they exist
    const existingUser = await User.findById(userId);
    if (!existingUser) {
      throw new Error(`User not found with ID: ${userId}`);
    }
    
    console.log(`Found user: ${existingUser.email}`);
    
    // Update user payment status and complete registration
    const user = await User.findByIdAndUpdate(
      userId,
      { 
        isPay: true,
        isRegistrationComplete: true,
        quotesEnabled: true,
        subscriptionId: subscriptionId || 'unknown',
        subscriptionStatus: 'active',
        paymentUpdatedAt: new Date() // Add timestamp for payment update
      },
      { new: true }
    );
    
    // Verify the update was successful
    if (!user) {
      throw new Error(`Failed to update user: ${userId}`);
    }
    
    // Verify the payment status was updated
    if (!user.isPay) {
      throw new Error(`Payment status not updated for user: ${userId}`);
    }
    
    console.log(`Payment processed successfully for user: ${userId}`);
    console.log(`Updated user data:`, JSON.stringify({
      email: user.email,
      isPay: user.isPay,
      subscriptionStatus: user.subscriptionStatus,
      quotesEnabled: user.quotesEnabled
    }, null, 2));
    
    return user;
  } catch (error) {
    console.error(`Error processing payment for user ${userId}:`, error);
    console.error('Error stack:', error.stack);
    throw error;
  }
};

// Send receipt email to user
const sendReceiptEmail = async (user, orderData) => {
  try {
    const transporter = nodemailer.createTransport({
      service: process.env.EMAIL_SERVICE || 'gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASSWORD
      }
    });

    const mailOptions = {
      from: process.env.EMAIL_FROM || `DailyInspire <${process.env.EMAIL_USER}>`,
      to: user.email,
      subject: 'Your DailyInspire Subscription Receipt',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
          <h2>Thank you for your subscription, ${user.first_name}!</h2>
          
          <p>Your payment has been successfully processed. Below are your transaction details:</p>
          
          <div style="background-color: #f8f9fa; padding: 15px; border-radius: 8px; margin: 20px 0;">
            <h3 style="margin-top: 0; color: #333;">Receipt Details</h3>
            <p><strong>Order ID:</strong> ${orderData.orderId || 'N/A'}</p>
            <p><strong>Date:</strong> ${new Date().toLocaleDateString()}</p>
            <p><strong>Plan:</strong> DailyInspire Premium</p>
            <p><strong>Amount:</strong> $4.99/month</p>
          </div>
          
          <p>Your subscription is now active. You'll start receiving daily inspirational quotes at your preferred time!</p>
          
          <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee;">
            <p style="color: #666; font-size: 14px;">If you have any questions about your subscription, please contact our support team.</p>
          </div>
        </div>
      `
    };

    await transporter.sendMail(mailOptions);
    console.log(`Receipt email sent to ${user.email}`);
    return true;
  } catch (error) {
    console.error('Error sending receipt email:', error);
    return false;
  }
};

// Get user payment status
const getUserPaymentStatus = async (userId) => {
  try {
    const user = await User.findById(userId);
    if (!user) {
      throw new Error(`User not found: ${userId}`);
    }
    return { 
      isPaid: user.isPay,
      subscriptionStatus: user.subscriptionStatus || 'none'
    };
  } catch (error) {
    console.error('Error getting payment status:', error);
    throw error;
  }
};

// Generate a direct checkout URL for LemonSqueezy
const generateLemonCheckoutUrl = (userId) => {
  const variantId = process.env.LEMON_SQUEEZY_VARIANT_ID || '9e44dcc7-edab-43f0-b9a2-9d663d4af336';
  
  if (!variantId) {
    throw new Error('Missing variant ID in environment variables');
  }
  
  // Fixed URL format with proper path structure
  // Format: https://dailyinspire.lemonsqueezy.com/buy/{variant-uuid}?params
  const baseUrl = `https://dailyinspire.lemonsqueezy.com/buy/${variantId}`;
  
  // Add query parameters with ? separator
  const fullUrl = `${baseUrl}?checkout[custom][user_id]=${encodeURIComponent(userId || 'unknown')}&discount=0`;
  
  console.log('Generated LemonSqueezy checkout URL:', fullUrl);
  
  return fullUrl;
};

module.exports = {
  lemonSqueezyApi,
  verifyWebhookSignature,
  processSuccessfulPayment,
  sendReceiptEmail,
  getUserPaymentStatus,
  generateLemonCheckoutUrl
}; 