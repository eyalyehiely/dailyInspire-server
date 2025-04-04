const axios = require('axios');
const User = require('../models/User');
const crypto = require('crypto');
const nodemailer = require('nodemailer');

// Initialize Paddle API client
const paddleApi = axios.create({
  baseURL: process.env.PADDLE_API_URL || 'https://api.paddle.com',
  headers: {
    'Authorization': `Bearer ${process.env.PADDLE_API_KEY}`,
    'Accept': 'application/json',
    'Content-Type': 'application/json'
  }
});

// Verify a webhook signature from Paddle
const verifyWebhookSignature = (signature, body) => {
  if (!process.env.PADDLE_WEBHOOK_SECRET) {
    console.error('⚠️ PADDLE_WEBHOOK_SECRET is not set in environment variables');
    return false;
  }

  try {
    // Extract the h1 part from the signature
    const h1Match = signature.match(/h1=([a-f0-9]+)/);
    if (!h1Match) {
      console.error('Invalid signature format - missing h1 parameter');
      return false;
    }
    const receivedSignature = h1Match[1];

    const bodyString = typeof body === 'string' ? body : JSON.stringify(body);
    const hmac = crypto.createHmac('sha256', process.env.PADDLE_WEBHOOK_SECRET);
    const calculatedSignature = hmac.update(bodyString).digest('hex');
    
    console.log('Verifying webhook signature:');
    console.log('Received signature:', receivedSignature);
    console.log('Calculated signature:', calculatedSignature);
    
    return calculatedSignature === receivedSignature;
  } catch (error) {
    console.error('Error verifying webhook signature:', error);
    return false;
  }
};

// Process successful payment
const processSuccessfulPayment = async (userId, subscriptionId) => {
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
    console.log('Current user status:', {
      isPay: existingUser.isPay,
      subscriptionStatus: existingUser.subscriptionStatus,
      quotesEnabled: existingUser.quotesEnabled,
      subscriptionId: existingUser.subscriptionId
    });
    
    // Use the subscription ID as is, without adding any prefix
    const formattedSubscriptionId = subscriptionId;
    console.log(`Using subscription ID: ${formattedSubscriptionId}`);
    
    // Update user payment status and complete registration
    const updateData = {
      isPay: true,
      isRegistrationComplete: true,
      quotesEnabled: true,
      subscriptionId: formattedSubscriptionId || existingUser.subscriptionId,
      subscriptionStatus: 'active',
      paymentUpdatedAt: new Date()
    };
    
    console.log('Updating user with data:', updateData);
    
    const user = await User.findByIdAndUpdate(
      userId,
      { $set: updateData },
      { new: true, runValidators: true }
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
    console.log(`Updated user data:`, {
      email: user.email,
      isPay: user.isPay,
      subscriptionStatus: user.subscriptionStatus,
      quotesEnabled: user.quotesEnabled,
      subscriptionId: user.subscriptionId,
      paymentUpdatedAt: user.paymentUpdatedAt
    });
    
    return user;
  } catch (error) {
    console.error(`Error processing payment for user ${userId}:`, error);
    console.error('Error stack:', error.stack);
    throw error;
  }
};

// Send receipt email
const sendReceiptEmail = async (user, { orderId }) => {
  try {
    console.log('Preparing to send receipt email to:', user.email);
    console.log('Email configuration:', {
      service: 'gmail',
      user: process.env.EMAIL_USER ? 'Set' : 'Not set',
      password: process.env.EMAIL_PASSWORD ? 'Set' : 'Not set'
    });
    
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASSWORD
      }
    });

    const mailOptions = {
      from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
      to: user.email,
      subject: 'Payment Receipt - DailyInspire',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
          <h1>Thank you for your payment!</h1>
          <p>Dear ${user.first_name || 'Valued Customer'},</p>
          <p>Your payment has been processed successfully.</p>
          <p><strong>Order ID:</strong> ${orderId}</p>
          <p>You now have access to all premium features.</p>
          
          <div style="margin: 30px 0; padding: 20px; background-color: #f8f9fa; border-radius: 8px;">
            <h3>Manage Your Subscription</h3>
            <p>You can manage your subscription anytime through our customer portal:</p>
            <p><a href="https://customer-portal.paddle.com/cpl_01jq9rqdm30n58mzpn6dcr7wbd" style="display: inline-block; background-color: #0066cc; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; margin-top: 10px;">Manage Subscription</a></p>
          </div>
          
          <p>Best regards,<br>The DailyInspire Team</p>
        </div>
      `
    };

    console.log('Sending receipt email to:', user.email);
    const info = await transporter.sendMail(mailOptions);
    console.log(`Receipt email sent successfully to ${user.email}. Message ID: ${info.messageId}`);
    return info;
  } catch (error) {
    console.error('Error sending receipt email:', error);
    console.error('Error details:', {
      message: error.message,
      code: error.code,
      command: error.command,
      response: error.response,
      responseCode: error.responseCode,
      stack: error.stack
    });
    // Don't throw the error, just log it
  }
};

// Get user payment status
const getUserPaymentStatus = async (userId) => {
  try {
    const user = await User.findById(userId);
    if (!user) {
      throw new Error('User not found');
    }

    return {
      isPaid: user.isPay,
      subscriptionStatus: user.subscriptionStatus,
      subscriptionId: user.subscriptionId
    };
  } catch (error) {
    console.error('Error getting user payment status:', error);
    throw error;
  }
};

// Generate a checkout URL for Paddle
const generateCheckoutUrl = (userId) => {
  if (!userId) {
    console.error('WARNING: Missing userId when generating checkout URL');
  }

  const appUrl = process.env.APP_URL || 'https://app.dailyinspire.xyz';
  const productId = process.env.PADDLE_PRODUCT_ID;
  
  if (!productId) {
    throw new Error('Missing Paddle product ID');
  }

  // Create a URLSearchParams object for proper parameter encoding
  const params = new URLSearchParams();
  params.append('items[0][price_id]', productId);
  params.append('items[0][quantity]', '1');
  params.append('customer_id', userId || 'unknown');
  params.append('success_url', `${appUrl}/payment-success`);
  params.append('cancel_url', `${appUrl}/payment`);

  // Return the Paddle checkout URL
  return `https://checkout.paddle.com/checkout/custom-checkout?${params.toString()}`;
};

// Verify a subscription status directly with the Paddle API
const verifySubscriptionStatus = async (subscriptionId) => {
  if (!subscriptionId) {
    return {
      id: null,
      status: 'none',
      isActive: false,
      customData: {}
    };
  }

  if (!process.env.PADDLE_API_KEY) {
    throw new Error('Missing Paddle API key');
  }

  // Use the subscription ID as is, without adding any prefix
  const formattedSubscriptionId = subscriptionId;
  console.log(`Using subscription ID: ${formattedSubscriptionId}`);

  const maxRetries = 3;
  let retryCount = 0;
  let lastError = null;

  while (retryCount < maxRetries) {
    try {
      const response = await paddleApi.get(`/subscriptions/${formattedSubscriptionId}`);
      
      if (!response || !response.data) {
        return {
          id: formattedSubscriptionId,
          status: 'not_found',
          isActive: false,
          customData: {}
        };
      }

      const subscriptionData = response.data;
      const status = subscriptionData.status;

      return {
        id: formattedSubscriptionId,
        status,
        isActive: status === 'active',
        customData: subscriptionData.custom_data || {}
      };
    } catch (error) {
      lastError = error;
      retryCount++;
      
      if (retryCount < maxRetries) {
        console.log(`Retry ${retryCount}/${maxRetries} for subscription ${formattedSubscriptionId}`);
        await new Promise(resolve => setTimeout(resolve, 1000 * retryCount)); // Exponential backoff
      }
    }
  }

  console.error(`Error verifying subscription status with Paddle API after ${maxRetries} retries: ${lastError.message}`);
  return {
    id: formattedSubscriptionId,
    status: 'error',
    isActive: false,
    customData: {}
  };
};

// Generate a client-side token for Paddle checkout
const generateClientToken = async (userId) => {
  if (!userId) {
    throw new Error('Missing userId when generating client token');
  }

  // Use the client token from environment variables
  const clientToken = process.env.PADDLE_CLIENT_TOKEN;
  
  if (!clientToken) {
    throw new Error('Missing Paddle client token in environment variables');
  }

  return clientToken;
};

module.exports = {
  paddleApi,
  verifyWebhookSignature,
  processSuccessfulPayment,
  sendReceiptEmail,
  getUserPaymentStatus,
  generateCheckoutUrl,
  verifySubscriptionStatus,
  generateClientToken
}; 