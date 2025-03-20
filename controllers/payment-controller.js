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
  if (!process.env.LEMON_SQUEEZY_WEBHOOK_SECRET) {
    console.error('LEMON_SQUEEZY_WEBHOOK_SECRET is not set in environment variables');
    return false;
  }
  
  try {
    // Convert body to string if it's an object
    const bodyString = typeof body === 'string' ? body : JSON.stringify(body);
    
    // Create HMAC using the webhook secret
    const hmac = crypto.createHmac('sha256', process.env.LEMON_SQUEEZY_WEBHOOK_SECRET);
    const calculatedSignature = hmac.update(bodyString).digest('hex');
    
    // Compare the calculated signature with the one provided in the request
    const isValid = crypto.timingSafeEqual(
      Buffer.from(calculatedSignature, 'hex'),
      Buffer.from(signature, 'hex')
    );
    
    return isValid;
  } catch (error) {
    console.error('Error verifying webhook signature:', error);
    return false;
  }
};

// Process a successful payment and mark registration as complete
const processSuccessfulPayment = async (userId, subscriptionId = null) => {
  try {
    // Update user payment status and complete registration
    const user = await User.findByIdAndUpdate(
      userId,
      { 
        isPay: true,
        isRegistrationComplete: true,
        quotesEnabled: true,
        subscriptionId: subscriptionId || 'unknown',
        subscriptionStatus: 'active'
      },
      { new: true }
    );
    
    if (!user) {
      throw new Error(`User not found: ${userId}`);
    }
    
    console.log(`Payment processed successfully for user: ${userId}`);
    return user;
  } catch (error) {
    console.error('Error processing payment:', error);
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
  const variantId = process.env.LEMON_SQUEEZY_VARIANT_ID;
  
  if (!variantId) {
    throw new Error('Missing variant ID in environment variables');
  }
  
  // UPDATED: Using the store-specific domain that matches the LemonSqueezy setup
  // Format: https://dailyinspire.lemonsqueezy.com/buy/[variant-uuid]
  const baseUrl = `https://dailyinspire.lemonsqueezy.com/buy/${variantId}`;
  
  // Create the full URL with properly encoded parameters
  // Note: Adding both the custom user_id parameter and the discount parameter
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