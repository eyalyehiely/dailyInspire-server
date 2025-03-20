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
  console.log('==== WEBHOOK SIGNATURE VERIFICATION ====');
  
  // Log the first 500 characters of the body for debugging
  const bodyPreview = typeof body === 'string' ? body.substring(0, 500) : JSON.stringify(body).substring(0, 500);
  console.log('Webhook body preview:', bodyPreview);
  console.log('Received signature:', signature);
  
  // Check if webhook secret is configured
  if (!process.env.LEMON_SQUEEZY_WEBHOOK_SECRET) {
    console.error('⚠️ LEMON_SQUEEZY_WEBHOOK_SECRET is not set in environment variables');
    return false;
  }
  
  try {
    // Convert body to string if it's an object
    const bodyString = typeof body === 'string' ? body : JSON.stringify(body);
    
    // Create HMAC using the webhook secret
    const hmac = crypto.createHmac('sha256', process.env.LEMON_SQUEEZY_WEBHOOK_SECRET);
    const calculatedSignature = hmac.update(bodyString).digest('hex');
    
    console.log('Calculated signature:', calculatedSignature);
    console.log('Received signature:', signature);
    console.log('Secret used (length):', process.env.LEMON_SQUEEZY_WEBHOOK_SECRET?.length || 'missing');
    
    // Try both the calculated signature and a trimmed version in case of whitespace issues
    const isExactMatch = calculatedSignature === signature;
    const isTrimmedMatch = calculatedSignature.trim() === signature.trim();
    
    console.log('Exact signature match:', isExactMatch);
    console.log('Trimmed signature match:', isTrimmedMatch);
    
    // If either matches, consider it valid
    return isExactMatch || isTrimmedMatch;
  } catch (error) {
    console.error('Error verifying webhook signature:', error);
    return false; // Reject if there's an error in verification
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
    
    // Check if the user is already paid
    if (existingUser.isPay && existingUser.subscriptionStatus === 'active') {
      console.log(`User ${userId} already has an active subscription, skipping update`);
      return existingUser;
    }
    
    // Record the original subscription ID if present for tracking changes
    const originalSubscriptionId = existingUser.subscriptionId;
    if (originalSubscriptionId && originalSubscriptionId !== subscriptionId) {
      console.log(`User ${userId} subscription ID changed from ${originalSubscriptionId} to ${subscriptionId}`);
    }
    
    // Update user payment status and complete registration
    const user = await User.findByIdAndUpdate(
      userId,
      { 
        isPay: true,
        isRegistrationComplete: true,
        quotesEnabled: true,
        subscriptionId: subscriptionId || existingUser.subscriptionId || 'unknown',
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
  
  if (!userId) {
    console.error('WARNING: Missing userId when generating checkout URL');
  }
  
  // Log the user ID for debugging
  console.log(`Generating checkout URL for user: ${userId}`);
  
  // Get the application URL from environment or use a default
  const appUrl = process.env.APP_URL || 'https://app.dailyinspire.xyz';
  
  // Fixed URL format with proper path structure
  // Format: https://dailyinspire.lemonsqueezy.com/buy/{variant-uuid}?params
  const baseUrl = `https://dailyinspire.lemonsqueezy.com/buy/${variantId}`;
  
  // Add query parameters with ? separator, including success and cancel URLs
  const fullUrl = `${baseUrl}?checkout[custom][user_id]=${encodeURIComponent(userId || 'unknown')}&discount=0&checkout[success_url]=${encodeURIComponent(`${appUrl}/payment-success`)}&checkout[cancel_url]=${encodeURIComponent(`${appUrl}/payment`)}`;
  
  console.log('Generated LemonSqueezy checkout URL:', fullUrl);
  
  return fullUrl;
};

// Verify a subscription status directly with the LemonSqueezy API
// Use this as a fallback when webhooks fail
const verifySubscriptionStatus = async (subscriptionId) => {
  if (!subscriptionId) {
    throw new Error('Missing subscription ID');
  }
  
  if (!process.env.LEMON_SQUEEZY_API_KEY) {
    throw new Error('Missing LemonSqueezy API key');
  }
  
  try {
    console.log(`Verifying subscription status directly with LemonSqueezy API: ${subscriptionId}`);
    
    const response = await lemonSqueezyApi.get(`/subscriptions/${subscriptionId}`);
    
    if (!response || !response.data || !response.data.data) {
      throw new Error('Invalid response from LemonSqueezy API');
    }
    
    console.log('LemonSqueezy API response:', JSON.stringify(response.data, null, 2));
    
    const subscriptionData = response.data.data;
    const status = subscriptionData.attributes?.status;
    
    console.log(`Subscription ${subscriptionId} status: ${status}`);
    
    return {
      id: subscriptionId,
      status,
      isActive: status === 'active',
      customData: subscriptionData.attributes?.custom_data || {}
    };
  } catch (error) {
    console.error(`Error verifying subscription status with LemonSqueezy API: ${error.message}`);
    throw error;
  }
};

module.exports = {
  lemonSqueezyApi,
  verifyWebhookSignature,
  processSuccessfulPayment,
  sendReceiptEmail,
  getUserPaymentStatus,
  generateLemonCheckoutUrl,
  verifySubscriptionStatus
}; 