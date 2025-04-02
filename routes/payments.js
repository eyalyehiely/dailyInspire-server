const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const User = require('../models/User');
const { 
  verifyWebhookSignature, 
  sendReceiptEmail, 
  processSuccessfulPayment,
  generateCheckoutUrl,
  verifySubscriptionStatus,
  paddleApi,
  generateClientToken
} = require('../controllers/paddle-controller');
const { sendWelcomeEmail } = require('../controllers/user-controller');
const mongoose = require('mongoose');

// Route to get payment page information
router.get('/checkout-info', auth, async (req, res) => {
  try {
    console.log('=== CHECKOUT INFO REQUEST ===');
    console.log('User ID:', req.user?.id);
    console.log('Auth token present:', !!req.headers.authorization);
    
    if (!req.user?.id) {
      console.error('No user ID found in request');
      return res.status(401).json({ 
        message: 'Authentication required',
        error: 'No user ID found'
      });
    }
    
    // Check if user is already paid
    const user = await User.findById(req.user.id);
    if (!user) {
      console.error('User not found:', req.user.id);
      return res.status(404).json({ 
        message: 'User not found',
        error: 'User not found in database'
      });
    }
    
    // If user already has paid status, return comprehensive subscription info
    if (user.isPay) {
      console.log('User already has premium access:', req.user.id);
      
      // Get additional subscription details from Paddle if available
      let subscriptionDetails = null;
      // let cardBrand = "";
      let cardLastFour = "";
      let customerPortalUrl = "";
      let cancelSubscriptionUrl = "";
      
      if (user.subscriptionId) {
        try {
          const response = await paddleApi.get(`/subscriptions/${user.subscriptionId}`);
          if (response.data) {
            const subData = response.data;
            subscriptionDetails = subData;
            
            // Extract card details
            cardBrand = subData.payment_information?.card_brand || "";
            cardLastFour = subData.payment_information?.last_four || "";
            
            // Extract URLs from the response
            customerPortalUrl = subData.customer_portal_url || "";
            cancelSubscriptionUrl = subData.cancel_url || "";
          }
        } catch (err) {
          console.error('Error fetching subscription details:', err.message);
        }
      }
      
      return res.json({ 
        isPaid: true, 
        message: 'You already have premium access',
        subscriptionStatus: user.subscriptionStatus || 'active',
        subscriptionId: user.subscriptionId || null,
        cardBrand,
        cardLastFour,
        customerPortalUrl,
        cancelSubscriptionUrl,
        subscriptionDetails,
        paymentUpdatedAt: user.paymentUpdatedAt,
        quotesEnabled: user.quotesEnabled
      });
    }
    
    // Return Paddle checkout information for non-paid users
    const responseData = {
      isPaid: false,
      productId: process.env.PADDLE_PRODUCT_ID,
      userId: req.user.id,
      subscriptionStatus: user.subscriptionStatus || 'none',
      subscriptionId: user.subscriptionId || null,
      quotesEnabled: user.quotesEnabled || false,
      paymentUpdatedAt: user.paymentUpdatedAt || null
    };
    
    console.log("Sending checkout info to client:", responseData);
    return res.json(responseData);
  } catch (error) {
    console.error('Error in checkout-info route:', error);
    return res.status(500).json({ 
      message: 'Server error', 
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// Webhook endpoint for Paddle to handle all subscription events
router.post('/webhook', async (req, res) => {
  try {
    console.log('===== WEBHOOK RECEIVED =====');
    console.log('Headers:', JSON.stringify(req.headers, null, 2));
    
    // Verify webhook signature from Paddle
    const signature = req.headers['x-paddle-signature'];
    if (!signature) {
      console.error('Missing webhook signature');
      return res.status(401).json({ error: 'Missing signature' });
    }
    
    // Get the raw body string - this should be available from body-parser raw
    const rawBody = req.rawBody;
    if (!rawBody) {
      console.error('Raw body not available - body-parser raw middleware may not be configured');
      return res.status(400).json({ error: 'Raw body not available' });
    }
    
    // Verify the signature with the raw body
    const isSignatureValid = verifyWebhookSignature(signature, rawBody);
    
    if (!isSignatureValid) {
      console.error('Invalid webhook signature');
      return res.status(401).json({ error: 'Invalid signature' });
    }
    
    // Parse the body
    let body;
    try {
      body = JSON.parse(rawBody);
    } catch (error) {
      console.error('Failed to parse webhook body:', error);
      return res.status(400).json({ error: 'Invalid JSON body' });
    }
    
    const eventType = body.event_type;
    if (!eventType) {
      console.error('Missing event_type in webhook body');
      return res.status(400).json({ error: 'Missing event_type' });
    }
    
    // Log the incoming webhook for debugging
    console.log(`Received Paddle webhook: ${eventType}`);
    console.log('Webhook data:', JSON.stringify(body, null, 2));
    
    // Extract user ID from custom data or find by email
    let userId = null;
    
    // Try to get user ID from custom data first
    if (body.data?.custom_data?.user_id) {
      userId = body.data.custom_data.user_id;
      console.log('Found user ID in custom data:', userId);
    }
    
    // If no user ID in custom data, try to find by email
    if (!userId && body.data?.customer_email) {
      const user = await User.findOne({ email: body.data.customer_email });
      if (user) {
        userId = user._id;
        console.log('Found user by email:', userId);
      }
    }
    
    if (!userId) {
      console.error('Could not find user ID from webhook data');
      return res.status(400).json({ error: 'Could not find user ID' });
    }
    
    // Handle different webhook events
    switch (eventType) {
      case 'subscription.created':
      case 'subscription.payment_succeeded':
      case 'checkout.completed':
        // When a new subscription is created or payment succeeds
        console.log(`Processing ${eventType} for user ${userId}`);
        
        // Extract subscription ID from various possible locations in the webhook data
        const subscriptionId = body.data?.subscription_id || 
                             body.data?.id || 
                             body.data?.attributes?.subscription_id ||
                             body.data?.attributes?.id;
        
        if (!subscriptionId) {
          console.error('Missing subscription ID in webhook data');
          console.log('Webhook data structure:', JSON.stringify(body, null, 2));
          return res.status(400).json({ error: 'Missing subscription ID' });
        }
        
        // Validate subscription ID format
        if (typeof subscriptionId !== 'string' || subscriptionId.trim().length === 0) {
          console.error('Invalid subscription ID format:', subscriptionId);
          return res.status(400).json({ error: 'Invalid subscription ID format' });
        }
        
        console.log('Processing payment with subscription ID:', subscriptionId);
        
        try {
          // Verify the subscription status with Paddle API
          const subscriptionData = await verifySubscriptionStatus(subscriptionId);
          console.log('Subscription data from Paddle:', subscriptionData);
          
          if (!subscriptionData.isActive) {
            console.error('Subscription is not active:', subscriptionData);
            return res.status(400).json({ error: 'Subscription is not active' });
          }
          
          // Process the payment
          const updatedUser = await processSuccessfulPayment(userId, subscriptionId);
          
          // Send welcome email if this is a new subscription
          if (eventType === 'subscription.created') {
            await sendWelcomeEmail(updatedUser);
          }
          
          // Send receipt email
          await sendReceiptEmail(updatedUser, {
            orderId: subscriptionId
          });
          
          console.log(`Successfully processed payment for user: ${updatedUser.email}`);
          return res.status(200).json({ 
            success: true,
            message: 'Payment processed successfully',
            user: {
              id: updatedUser._id,
              email: updatedUser.email,
              isPay: updatedUser.isPay,
              subscriptionStatus: updatedUser.subscriptionStatus,
              quotesEnabled: updatedUser.quotesEnabled
            }
          });
        } catch (error) {
          console.error('Error processing payment:', error);
          console.error('Error stack:', error.stack);
          return res.status(500).json({ 
            error: error.message,
            details: process.env.NODE_ENV === 'development' ? error.stack : undefined
          });
        }
        
      case 'subscription.cancelled':
        // When a subscription is cancelled
        console.log(`Processing subscription cancellation for user ${userId}`);
        await User.findByIdAndUpdate(userId, { 
          subscriptionStatus: 'cancelled',
          quotesEnabled: false,
          isPay: false
        });
        console.log(`Subscription cancelled for user ${userId}`);
        break;
        
      case 'subscription.updated':
        // When a subscription is updated
        const status = body.data.status;
        console.log(`Processing subscription update for user ${userId} to status: ${status}`);
        await User.findByIdAndUpdate(userId, { 
          subscriptionStatus: status,
          quotesEnabled: status === 'active',
          isPay: status === 'active'
        });
        console.log(`Subscription updated for user ${userId}`);
        break;
        
      default:
        console.log(`Unhandled webhook event: ${eventType}`);
    }
    
    // Verify the update was successful
    const finalUser = await User.findById(userId);
    console.log('Final user status:', {
      email: finalUser.email,
      isPay: finalUser.isPay,
      subscriptionStatus: finalUser.subscriptionStatus,
      quotesEnabled: finalUser.quotesEnabled,
      subscriptionId: finalUser.subscriptionId,
      paymentUpdatedAt: finalUser.paymentUpdatedAt
    });
    
    console.log(`Webhook processed successfully for event: ${eventType}`);
    return res.status(200).json({ received: true, status: 'processed' });
  } catch (error) {
    console.error('Webhook error:', error);
    console.error('Error stack:', error.stack);
    return res.status(200).json({ message: 'Webhook error', error: error.message });
  }
});

// Route to check user's current payment status
router.get('/status', auth, async (req, res) => {
  try {
    console.log('Checking payment status for user:', req.user.id);
    
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    // Check if the user has a subscription
    let cardBrand = "";
    let cardLastFour = "";
    let customerPortalUrl = "";
    let cancelSubscriptionUrl = "";
    let subscriptionDetails = null;
    
    // If user has a subscription ID, fetch card details and URLs from Paddle API
    if (user.subscriptionId && user.isPay) {
      try {
        const response = await paddleApi.get(`/subscriptions/${user.subscriptionId}`);
        if (response.data) {
          const subData = response.data;
          subscriptionDetails = subData;
          
          // Extract card details
          cardBrand = subData.payment_information?.card_brand || "";
          cardLastFour = subData.payment_information?.last_four || "";
          
          // Extract URLs from the response
          customerPortalUrl = subData.customer_portal_url || "";
          cancelSubscriptionUrl = subData.cancel_url || "";
        }
      } catch (err) {
        console.error('Error fetching subscription details:', err.message);
      }
    }
    
    return res.json({
      isPay: user.isPay,
      isRegistrationComplete: user.isRegistrationComplete,
      quotesEnabled: user.quotesEnabled,
      subscriptionStatus: user.subscriptionStatus,
      subscriptionId: user.subscriptionId,
      cardBrand,
      cardLastFour,
      customerPortalUrl,
      cancelSubscriptionUrl,
      subscriptionDetails,
      paymentUpdatedAt: user.paymentUpdatedAt
    });
  } catch (error) {
    console.error('Error checking payment status:', error);
    return res.status(500).json({ message: 'Server error' });
  }
});

// Route for testing lemon squeezy configuration


// Debug endpoint for testing checkout URLs


// Raw webhook debug endpoint - logs all incoming webhook data without verification
router.post('/webhook-debug', async (req, res) => {
  try {
    console.log('===== WEBHOOK DEBUG ENDPOINT TRIGGERED =====');
    
    const fs = require('fs');
    const path = require('path');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const logDir = path.join(__dirname, '../logs');
    
    // Create logs directory if it doesn't exist
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    
    // Extract any potential user IDs from the data for easier debugging
    let possibleUserIds = [];
    const body = req.body;
    
    // Look in common places for user IDs
    if (body?.data?.attributes?.custom_data?.user_id) {
      possibleUserIds.push(body.data.attributes.custom_data.user_id);
    }
    if (body?.meta?.custom_data?.user_id) {
      possibleUserIds.push(body.meta.custom_data.user_id);
    }
    if (req.query.user_id) {
      possibleUserIds.push(req.query.user_id);
    }
    
    // Log the raw headers and body
    const logData = {
      timestamp: new Date().toISOString(),
      possibleUserIds,
      headers: req.headers,
      body: req.body,
      query: req.query
    };
    
    // Write to file
    const logPath = path.join(logDir, `webhook-debug-${timestamp}.json`);
    fs.writeFileSync(logPath, JSON.stringify(logData, null, 2));
    
    console.log(`Webhook debug data saved to ${logPath}`);
    console.log('Possible User IDs:', possibleUserIds);
    console.log('Headers:', JSON.stringify(req.headers, null, 2));
    console.log('Body:', JSON.stringify(req.body, null, 2));
    
    // Try to process this webhook data through the normal webhook handler logic
    if (body.meta?.event_name && possibleUserIds.length > 0) {
      console.log('Attempting to process webhook data...');
      
      // Try each user ID until one works
      for (const userId of possibleUserIds) {
        try {
          if (!mongoose.Types.ObjectId.isValid(userId)) {
            console.log(`Invalid user ID format: ${userId}, skipping`);
            continue;
          }
          
          const user = await User.findById(userId);
          if (!user) {
            console.log(`User not found with ID: ${userId}, skipping`);
            continue;
          }
          
          console.log(`Found user: ${user.email} with ID: ${userId}`);
          
          // Process the webhook based on event type
          const eventName = body.meta.event_name;
          
          if (eventName === 'subscription_created' || eventName === 'order_created') {
            const updatedUser = await processSuccessfulPayment(userId, body.data?.id || 'debug-webhook');
            console.log(`Successfully processed payment for user: ${updatedUser.email}`);
          }
          
          break; // Exit loop once a valid user is processed
        } catch (err) {
          console.error(`Error processing user ${userId}:`, err);
        }
      }
    }
    
    // Always respond with success
    return res.status(200).json({ 
      received: true, 
      status: 'debug_logged',
      possibleUserIds
    });
  } catch (error) {
    console.error('Webhook debug error:', error);
    return res.status(200).json({ received: true, error: error.message }); // Still return 200 to avoid retries
  }
});

// Webhook simulation endpoint for testing
router.post('/simulate-webhook', async (req, res) => {
  try {
    console.log('===== SIMULATING LEMON SQUEEZY WEBHOOK =====');
    
    // Get the user ID from the request
    const userId = req.body.user_id || req.query.user_id;
    if (!userId) {
      return res.status(400).json({ error: 'Missing user_id parameter' });
    }
    
    // Check if the user exists
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: `User not found: ${userId}` });
    }
    
    console.log(`Found user: ${user.email}`);
    
    // Create a mock webhook event
    const mockEvent = {
      meta: {
        event_name: 'subscription_created',
        custom_data: {
          user_id: userId
        }
      },
      data: {
        id: 'test-subscription-' + Date.now(),
        attributes: {
          user_id: userId,
          custom_data: {
            user_id: userId
          }
        }
      }
    };
    
    console.log('Mock webhook payload:', JSON.stringify(mockEvent, null, 2));
    
    // Process the payment
    const updatedUser = await processSuccessfulPayment(userId, mockEvent.data.id);
    
    // Send the welcome email
    await sendWelcomeEmail(updatedUser);
    
    // Send the receipt email
    await sendReceiptEmail(updatedUser, {
      orderId: mockEvent.data.id
    });
    
    return res.status(200).json({
      success: true,
      user: {
        id: updatedUser._id,
        email: updatedUser.email,
        isPay: updatedUser.isPay,
        subscriptionStatus: updatedUser.subscriptionStatus
      }
    });
  } catch (error) {
    console.error('Simulation error:', error);
    return res.status(500).json({ error: error.message });
  }
});

// Debug endpoint to check a user's payment status (for admin debugging only)
router.get('/debug-user-status', async (req, res) => {
  try {
    const { email, userId } = req.query;
    
    if (!email && !userId) {
      return res.status(400).json({ error: 'Please provide either email or userId query parameter' });
    }
    
    let user;
    
    if (email) {
      user = await User.findOne({ email });
    } else if (userId && mongoose.Types.ObjectId.isValid(userId)) {
      user = await User.findById(userId);
    }
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Return user payment information
    return res.json({
      id: user._id.toString(),
      email: user.email,
      name: `${user.first_name} ${user.last_name}`,
      isPay: user.isPay,
      isRegistrationComplete: user.isRegistrationComplete,
      quotesEnabled: user.quotesEnabled,
      subscriptionStatus: user.subscriptionStatus || 'none',
      subscriptionId: user.subscriptionId || 'none',
      paymentUpdatedAt: user.paymentUpdatedAt || 'never'
    });
  } catch (error) {
    console.error('Error in debug-user-status endpoint:', error);
    return res.status(500).json({ error: error.message });
  }
});

// Admin endpoint to manually upgrade a user (should be behind admin auth in production)
router.post('/admin/force-upgrade', async (req, res) => {
  try {
    const { email, userId } = req.body;
    
    if (!email && !userId) {
      return res.status(400).json({ error: 'Please provide either email or userId in the request body' });
    }
    
    let user;
    
    if (email) {
      user = await User.findOne({ email });
    } else if (userId && mongoose.Types.ObjectId.isValid(userId)) {
      user = await User.findById(userId);
    }
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Process the upgrade
    const subscriptionId = `admin-upgrade-${Date.now()}`;
    const updatedUser = await processSuccessfulPayment(user._id.toString(), subscriptionId);
    
    // Return upgraded user information
    return res.json({
      success: true,
      message: `User ${updatedUser.email} has been upgraded to paid status`,
      user: {
        id: updatedUser._id.toString(),
        email: updatedUser.email,
        name: `${updatedUser.first_name} ${updatedUser.last_name}`,
        isPay: updatedUser.isPay,
        subscriptionStatus: updatedUser.subscriptionStatus
      }
    });
  } catch (error) {
    console.error('Error in force-upgrade endpoint:', error);
    return res.status(500).json({ error: error.message });
  }
});

module.exports = router;