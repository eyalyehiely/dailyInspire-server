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
    const bodyString = typeof body === 'string' ? body : JSON.stringify(body);
    const hmac = crypto.createHmac('sha256', process.env.PADDLE_WEBHOOK_SECRET);
    const calculatedSignature = hmac.update(bodyString).digest('hex');
    return calculatedSignature === signature;
  } catch (error) {
    console.error('Error verifying webhook signature:', error);
    return false;
  }
};

// Process successful payment
const processSuccessfulPayment = async (userId, subscriptionId) => {
  try {
    const user = await User.findByIdAndUpdate(
      userId,
      {
        isPay: true,
        isRegistrationComplete: true,
        quotesEnabled: true,
        subscriptionStatus: 'active',
        subscriptionId: subscriptionId,
        paymentUpdatedAt: new Date()
      },
      { new: true }
    );

    if (!user) {
      throw new Error('User not found');
    }

    return user;
  } catch (error) {
    console.error('Error processing payment:', error);
    throw error;
  }
};

// Send receipt email
const sendReceiptEmail = async (user, { orderId }) => {
  try {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASSWORD
      }
    });

    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: user.email,
      subject: 'Payment Receipt - DailyInspire',
      html: `
        <h1>Thank you for your payment!</h1>
        <p>Dear ${user.name || 'Valued Customer'},</p>
        <p>Your payment has been processed successfully.</p>
        <p>Order ID: ${orderId}</p>
        <p>You now have access to all premium features.</p>
        <p>Best regards,<br>The DailyInspire Team</p>
      `
    };

    await transporter.sendMail(mailOptions);
    console.log('Receipt email sent successfully');
  } catch (error) {
    console.error('Error sending receipt email:', error);
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
    throw new Error('Missing subscription ID');
  }

  if (!process.env.PADDLE_API_KEY) {
    throw new Error('Missing Paddle API key');
  }

  try {
    const response = await paddleApi.get(`/subscriptions/${subscriptionId}`);
    
    if (!response || !response.data) {
      throw new Error('Invalid response from Paddle API');
    }

    const subscriptionData = response.data;
    const status = subscriptionData.status;

    return {
      id: subscriptionId,
      status,
      isActive: status === 'active',
      customData: subscriptionData.custom_data || {}
    };
  } catch (error) {
    console.error(`Error verifying subscription status with Paddle API: ${error.message}`);
    throw error;
  }
};

// Generate a client-side token for Paddle checkout
const generateClientToken = async (userId) => {
  if (!userId) {
    throw new Error('Missing userId when generating client token');
  }

  try {
    const response = await paddleApi.post('/checkout/tokens', {
      items: [{
        price_id: process.env.PADDLE_PRODUCT_ID,
        quantity: 1
      }],
      custom_data: {
        user_id: userId
      },
      success_url: `${process.env.APP_URL}/payment-success`,
      cancel_url: `${process.env.APP_URL}/payment`
    });

    return response.data.token;
  } catch (error) {
    console.error('Error generating client token:', error);
    throw error;
  }
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