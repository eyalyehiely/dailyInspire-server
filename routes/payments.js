const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const User = require('../models/User');
const { 
  verifyWebhookSignature, 
  sendReceiptEmail, 
  processSuccessfulPayment,
  generateLemonCheckoutUrl,
  verifySubscriptionStatus
} = require('../controllers/payment-controller');
const { sendWelcomeEmail } = require('../controllers/user-controller');
const mongoose = require('mongoose');

// Route to get payment page information
router.get('/checkout-info', auth, async (req, res) => {
  try {
    console.log('=== CHECKOUT INFO REQUEST ===');
    console.log('User ID:', req.user.id);
    
    // Check if user is already paid
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    // If user already has paid status, return that info
    if (user.isPay) {
      console.log('User already has premium access:', req.user.id);
      return res.json({ 
        isPaid: true, 
        message: 'You already have premium access',
        subscriptionStatus: user.subscriptionStatus || 'active',
        subscriptionId: user.subscriptionId || null
      });
    }
    
    // Generate direct checkout URL
    const directCheckoutUrl = generateLemonCheckoutUrl(req.user.id);
    console.log("Generated checkout URL with user ID:", req.user.id);
    console.log("Full checkout URL:", directCheckoutUrl);
    
    // Return Lemon Squeezy checkout information with more complete data
    const responseData = {
      isPaid: false,
      variantId: process.env.LEMON_SQUEEZY_VARIANT_ID || '9e44dcc7-edab-43f0-b9a2-9d663d4af336',
      productId: process.env.LEMON_SQUEEZY_PRODUCT_ID || '471688',
      userId: req.user.id,
      directCheckoutUrl,
      subscriptionStatus: user.subscriptionStatus || 'none',
      subscriptionId: user.subscriptionId || null
    };
    
    console.log("Sending checkout info to client:", responseData);
    return res.json(responseData);
  } catch (error) {
    console.error('Error getting checkout info:', error);
    return res.status(500).json({ message: 'Server error' });
  }
});

// Webhook endpoint for LemonSqueezy to handle all subscription events
router.post('/webhook', async (req, res) => {
  try {
    console.log('===== WEBHOOK RECEIVED =====');
    console.log('Headers:', JSON.stringify(req.headers, null, 2));
    
    // Verify webhook signature from LemonSqueezy
    const signature = req.headers['x-signature'];
    if (!signature) {
      console.warn('Missing webhook signature');
      return res.status(401).json({ error: 'Missing signature' });
    }
    
    // Important: We need the raw body string for signature verification
    // Express typically parses JSON, but we need the unparsed string
    // This raw body should be accessed via req.rawBody which should be
    // set in middleware before JSON parsing
    const rawBody = req.rawBody || JSON.stringify(req.body);
    
    // Verify the signature with the raw body
    const isSignatureValid = verifyWebhookSignature(signature, rawBody);
    
    if (!isSignatureValid) {
      console.warn('Invalid webhook signature');
      console.warn('Expected signature:', signature);
      console.warn('Secret used:', process.env.LEMON_SQUEEZY_WEBHOOK_SECRET ? 'Secret is set' : 'Secret is missing!');
      return res.status(401).json({ error: 'Invalid signature' });
    }
    
    // Parse the body (if it was provided raw)
    const body = req.body || (typeof rawBody === 'string' ? JSON.parse(rawBody) : rawBody);
    const eventName = body.meta?.event_name;
    
    // Log the incoming webhook for debugging
    console.log(`Received Lemon Squeezy webhook: ${eventName}`);
    console.log('Webhook data:', JSON.stringify(body, null, 2));
    
    // Extract user ID from custom data - more thorough search in all possible locations
    let userId;
    
    // Check all possible locations for user_id
    const possibleLocations = [
      body.data?.attributes?.custom_data?.user_id,
      body.data?.attributes?.first_order_item?.custom_data?.user_id,
      body.meta?.custom_data?.user_id,
      body.data?.attributes?.custom_data?.userId,
      body.data?.attributes?.first_order_item?.custom_data?.userId,
      body.meta?.custom_data?.userId,
      // Check for checkout URL custom parameters
      body.data?.attributes?.urls?.checkout_url,
      // Check inside custom_data if it's a stringified JSON
      body.data?.attributes?.custom_data,
      body.meta?.custom_data,
    ];
    
    // Try each location
    for (const location of possibleLocations) {
      if (location) {
        // If it's a URL, try to extract user_id from the query string
        if (typeof location === 'string' && location.includes('checkout') && location.includes('user_id')) {
          try {
            const url = new URL(location);
            const params = new URLSearchParams(url.search);
            const customUserIdParam = params.get('checkout[custom][user_id]');
            if (customUserIdParam) {
              userId = customUserIdParam;
              console.log('Extracted user_id from checkout URL:', userId);
              break;
            }
          } catch (e) {
            console.log('Failed to parse URL:', location);
          }
        } 
        // If it's a stringified JSON object, try to parse it
        else if (typeof location === 'string' && 
                (location.includes('{') || location.includes('user_id') || location.includes('userId'))) {
          try {
            const parsed = JSON.parse(location);
            if (parsed.user_id) {
              userId = parsed.user_id;
              console.log('Extracted user_id from parsed JSON:', userId);
              break;
            } else if (parsed.userId) {
              userId = parsed.userId;
              console.log('Extracted userId from parsed JSON:', userId);
              break;
            }
          } catch (e) {
            // Not a valid JSON, check for url-encoded params
            if (location.includes('user_id=')) {
              try {
                const userIdMatch = location.match(/user_id=([^&]+)/);
                if (userIdMatch && userIdMatch[1]) {
                  userId = decodeURIComponent(userIdMatch[1]);
                  console.log('Extracted user_id from string pattern:', userId);
                  break;
                }
              } catch (e) {
                console.log('Failed to extract user_id from string pattern');
              }
            }
          }
        }
        else {
          // Direct value
          userId = location;
          console.log(`Found user_id in webhook data:`, userId);
          break;
        }
      }
    }
    
    // Final fallback: deep scan of the entire body for user_id
    if (!userId) {
      console.log('No user ID found in standard locations, performing deep search...');
      const bodyStr = JSON.stringify(body);
      
      // Try to find user_id in the stringified body
      let userIdMatch = bodyStr.match(/"user_id":\s*"([^"]+)"/);
      if (userIdMatch && userIdMatch[1]) {
        userId = userIdMatch[1];
        console.log('Found user_id with deep search:', userId);
      } else {
        // Try userId variant
        userIdMatch = bodyStr.match(/"userId":\s*"([^"]+)"/);
        if (userIdMatch && userIdMatch[1]) {
          userId = userIdMatch[1];
          console.log('Found userId with deep search:', userId);
        }
      }
    }
    
    if (!userId) {
      console.warn('No user ID found in webhook data, dumping full payload:');
      console.warn(JSON.stringify(body, null, 2));
      return res.status(200).json({ received: true, status: 'No user ID found' });
    }
    
    // Validate the user ID is a valid MongoDB ID
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      console.warn(`Received invalid user ID format: ${userId}`);
      return res.status(200).json({ received: true, status: 'Invalid user ID format' });
    }
    
    // Check if user exists
    const userExists = await User.findById(userId);
    if (!userExists) {
      console.warn(`User with ID ${userId} not found in database`);
      return res.status(200).json({ received: true, status: 'User not found' });
    }
    
    // Handle different webhook events
    console.log(`Processing webhook event ${eventName} for user ${userId}`);
    
    switch (eventName) {
      case 'order_created':
        // When a new order is created
        console.log(`New order created for user ${userId}`);
        break;
        
      case 'subscription_created':
        // When a subscription is created - complete the registration process
        try {
          // Update user record
          const user = await processSuccessfulPayment(userId, body.data.id);
          
          // Send welcome email now that subscription is complete
          await sendWelcomeEmail(user);
          
          // Send receipt email
          await sendReceiptEmail(user, {
            orderId: body.data.attributes.order_id || body.data.id
          });
          
          console.log(`Subscription created for user ${userId}, registration completed`);
        } catch (err) {
          console.error(`Error processing subscription for user ${userId}:`, err);
        }
        break;
        
      case 'subscription_cancelled':
        // When a subscription is cancelled but still active until the end of the billing period
        await User.findByIdAndUpdate(userId, { 
          subscriptionStatus: 'cancelled'
        });
        console.log(`Subscription cancelled for user ${userId}`);
        break;
        
      case 'subscription_expired':
        // When a subscription has expired after cancellation
        await User.findByIdAndUpdate(userId, { 
          isPay: false,
          subscriptionStatus: 'expired',
          quotesEnabled: false
        });
        console.log(`Subscription expired for user ${userId}`);
        break;
        
      case 'subscription_paused':
        // When a subscription is paused
        await User.findByIdAndUpdate(userId, { 
          subscriptionStatus: 'paused'
        });
        console.log(`Subscription paused for user ${userId}`);
        break;
        
      case 'subscription_unpaused':
        // When a subscription is resumed after being paused
        await User.findByIdAndUpdate(userId, { 
          isPay: true,
          subscriptionStatus: 'active',
          quotesEnabled: true
        });
        console.log(`Subscription unpaused for user ${userId}`);
        break;
        
      case 'subscription_payment_failed':
        // When a subscription payment fails
        await User.findByIdAndUpdate(userId, { 
          subscriptionStatus: 'payment_failed'
        });
        console.log(`Subscription payment failed for user ${userId}`);
        break;
        
      case 'subscription_payment_success':
        // When a subscription payment succeeds
        await User.findByIdAndUpdate(userId, { 
          isPay: true,
          subscriptionStatus: 'active',
          quotesEnabled: true
        });
        
        // Get user to send receipt
        const user = await User.findById(userId);
        if (user) {
          await sendReceiptEmail(user, {
            orderId: body.data.attributes.order_id || body.data.id
          });
        }
        
        console.log(`Subscription payment successful for user ${userId}`);
        break;
        
      default:
        console.log(`Unhandled webhook event: ${eventName}`);
    }
    
    console.log(`Webhook processed successfully for event: ${eventName}`);
    return res.status(200).json({ received: true, status: 'processed' });
  } catch (error) {
    console.error('Webhook error:', error);
    // Include the stack trace for better debugging
    console.error('Error stack:', error.stack);
    return res.status(200).json({ message: 'Webhook error', error: error.message }); // Return 200 to avoid retries
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
    
    return res.json({
      isPaid: user.isPay || false,
      subscriptionStatus: user.subscriptionStatus || 'none',
      subscriptionId: user.subscriptionId,
      quotesEnabled: user.quotesEnabled || false,
      paymentUpdatedAt: user.paymentUpdatedAt
    });
  } catch (error) {
    console.error('Error checking payment status:', error);
    return res.status(500).json({ message: 'Server error' });
  }
});

// Route for testing lemon squeezy configuration
router.get('/test-lemon-config', async (req, res) => {
  try {
    const variantId = process.env.LEMON_SQUEEZY_VARIANT_ID || '9e44dcc7-edab-43f0-b9a2-9d663d4af336';
    const checkoutUrl = `https://dailyinspire.lemonsqueezy.com/buy/${variantId}`;
    
    return res.json({
      message: 'Lemon Squeezy configuration',
      variantId: variantId,
      checkoutUrl: checkoutUrl,
      sampleUrlWithUserId: `${checkoutUrl}?checkout[custom][user_id]=test-user-id&discount=0`
    });
  } catch (error) {
    console.error('Error in test endpoint:', error);
    return res.status(500).json({ message: 'Server error' });
  }
});

// Debug endpoint for testing checkout URLs
router.get('/debug-checkout', async (req, res) => {
  try {
    const testUserId = 'test-user-123';
    const variantId = process.env.LEMON_SQUEEZY_VARIANT_ID || '9e44dcc7-edab-43f0-b9a2-9d663d4af336';
    
    // Create URLs with different formats for testing
    const urls = {
      // Store-specific domain format (based on actual URL pattern)
      storeSpecific: `https://dailyinspire.lemonsqueezy.com/buy/${variantId}?checkout[custom][user_id]=${testUserId}&discount=0`,
      
      // With encoded brackets
      encoded: `https://dailyinspire.lemonsqueezy.com/buy/${variantId}?checkout%5Bcustom%5D%5Buser_id%5D=${testUserId}&discount=0`,
      
      // Using searchParams
      withSearchParams: (() => {
        const url = new URL(`https://dailyinspire.lemonsqueezy.com/buy/${variantId}`);
        url.searchParams.append('checkout[custom][user_id]', testUserId);
        url.searchParams.append('discount', '0');
        return url.toString();
      })(),
      
      // Using the helper function
      fromHelper: generateLemonCheckoutUrl(testUserId)
    };
    
    return res.json({
      message: 'Debug checkout URLs',
      userId: testUserId,
      variantId: variantId,
      urls
    });
  } catch (error) {
    console.error('Error in debug endpoint:', error);
    return res.status(500).json({ message: 'Server error' });
  }
});

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

// Super simple raw webhook log endpoint - logs everything and returns 200
router.post('/raw-webhook-log', async (req, res) => {
  try {
    console.log('==== RAW WEBHOOK RECEIVED ====');
    console.log('Headers:', JSON.stringify(req.headers, null, 2));
    console.log('Body:', JSON.stringify(req.body, null, 2));
    console.log('Query:', JSON.stringify(req.query, null, 2));
    
    // Create logs directory if it doesn't exist
    const fs = require('fs');
    const path = require('path');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const logDir = path.join(__dirname, '../logs');
    
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    
    // Log to file
    const logFile = path.join(logDir, `raw-webhook-${timestamp}.json`);
    fs.writeFileSync(logFile, JSON.stringify({
      timestamp,
      headers: req.headers,
      body: req.body,
      query: req.query
    }, null, 2));
    
    console.log(`Raw webhook logged to: ${logFile}`);
    
    // Extract user ID from various possible locations
    let userId = null;
    const body = req.body;
    
    if (body?.data?.attributes?.custom_data?.user_id) {
      userId = body.data.attributes.custom_data.user_id;
    } else if (body?.meta?.custom_data?.user_id) {
      userId = body.meta.custom_data.user_id;
    } else if (body?.data?.attributes?.first_order_item?.custom_data?.user_id) {
      userId = body.data.attributes.first_order_item.custom_data.user_id;
    }
    
    // Return success
    return res.status(200).json({ 
      success: true, 
      message: 'Webhook logged',
      extractedUserId: userId
    });
  } catch (error) {
    console.error('Raw webhook log error:', error);
    // Always return 200 to prevent retries
    return res.status(200).json({ success: false, error: error.message });
  }
});

// Test endpoint to manually update a user's payment status (for debugging)
router.get('/test-update-user/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    
    console.log(`===== TEST UPDATE USER PAYMENT STATUS =====`);
    console.log(`Attempting to update user: ${userId}`);
    
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ error: 'Invalid user ID format' });
    }
    
    // Verify user exists
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    console.log(`Found user: ${user.email}`);
    
    // Get user's current payment status
    const beforeUpdate = {
      id: user._id.toString(),
      email: user.email,
      isPay: user.isPay,
      isRegistrationComplete: user.isRegistrationComplete,
      quotesEnabled: user.quotesEnabled,
      subscriptionStatus: user.subscriptionStatus || 'none'
    };
    
    // Process the payment update
    const subscriptionId = `test-manual-update-${Date.now()}`;
    const updatedUser = await processSuccessfulPayment(userId, subscriptionId);
    
    // Get updated status
    const afterUpdate = {
      id: updatedUser._id.toString(),
      email: updatedUser.email,
      isPay: updatedUser.isPay,
      isRegistrationComplete: updatedUser.isRegistrationComplete,
      quotesEnabled: updatedUser.quotesEnabled,
      subscriptionStatus: updatedUser.subscriptionStatus
    };
    
    // Return success with before/after comparison
    return res.json({
      success: true,
      message: `User payment status updated successfully`,
      before: beforeUpdate,
      after: afterUpdate
    });
    
  } catch (error) {
    console.error('Error in test update endpoint:', error);
    return res.status(500).json({ error: error.message });
  }
});

// Route to log checkout attempts
router.post('/log-checkout', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { checkoutUrl } = req.body;
    
    console.log(`Logging checkout attempt for user ${userId}`);
    console.log('Checkout URL:', checkoutUrl);
    
    // Update user record with checkout attempt details
    await User.findByIdAndUpdate(userId, {
      lastCheckoutAttempt: {
        timestamp: new Date(),
        url: checkoutUrl
      }
    });
    
    return res.json({ success: true });
  } catch (error) {
    console.error('Error logging checkout:', error);
    return res.status(500).json({ message: 'Server error' });
  }
});

// Endpoint to manually check and repair a subscription status
router.post('/check-subscription', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { subscriptionId } = req.body;
    
    console.log(`Manual subscription check requested for user ${userId}`);
    
    if (!subscriptionId) {
      return res.status(400).json({ message: 'Missing subscription ID' });
    }
    
    // Find the user
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    console.log(`Checking subscription ${subscriptionId} for user ${userId}`);
    
    // Verify the subscription with LemonSqueezy API
    const subscriptionData = await verifySubscriptionStatus(subscriptionId);
    
    // Update user status based on subscription state
    if (subscriptionData.isActive) {
      console.log(`Subscription ${subscriptionId} is active, updating user payment status`);
      
      await User.findByIdAndUpdate(userId, {
        isPay: true,
        isRegistrationComplete: true,
        quotesEnabled: true,
        subscriptionStatus: 'active',
        subscriptionId: subscriptionId,
        paymentUpdatedAt: new Date()
      });
      
      return res.json({ 
        success: true, 
        message: 'Subscription is active, user status updated',
        subscriptionStatus: 'active'
      });
    } else {
      console.log(`Subscription ${subscriptionId} is not active (${subscriptionData.status})`);
      
      // Update the status to reflect the actual state
      await User.findByIdAndUpdate(userId, {
        subscriptionStatus: subscriptionData.status,
        // Only disable premium features if truly expired/cancelled
        isPay: !['expired', 'cancelled'].includes(subscriptionData.status),
        quotesEnabled: !['expired', 'cancelled'].includes(subscriptionData.status)
      });
      
      return res.json({
        success: true,
        message: `Subscription status updated to ${subscriptionData.status}`,
        subscriptionStatus: subscriptionData.status
      });
    }
  } catch (error) {
    console.error('Error checking subscription:', error);
    return res.status(500).json({ message: 'Error checking subscription', error: error.message });
  }
});

module.exports = router; 