const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const User = require('../models/User');
const { 
  verifyWebhookSignature, 
  sendReceiptEmail, 
  processSuccessfulPayment,
  generateLemonCheckoutUrl
} = require('../controllers/payment-controller');
const { sendWelcomeEmail } = require('../controllers/user-controller');

// Route to get payment page information
router.get('/checkout-info', auth, async (req, res) => {
  try {
    console.log('=== CHECKOUT INFO REQUEST ===');
    console.log('User ID:', req.user.id);
    
    // Check if user is already paid
    const user = await User.findById(req.user.id);
    if (user.isPay) {
      console.log('User already has premium access:', req.user.id);
      return res.json({ isPaid: true, message: 'You already have premium access' });
    }
    
    // Log environment variables for debugging
    console.log("Payment checkout info - Environment variables:");
    console.log("VARIANT_ID:", process.env.LEMON_SQUEEZY_VARIANT_ID);
    
    // Generate direct checkout URL
    const directCheckoutUrl = generateLemonCheckoutUrl(req.user.id);
    console.log("Generated checkout URL with user ID:", req.user.id);
    console.log("Full checkout URL:", directCheckoutUrl);
    
    // Return Lemon Squeezy checkout information
    const responseData = {
      isPaid: false,
      variantId: process.env.LEMON_SQUEEZY_VARIANT_ID,
      userId: req.user.id,
      directCheckoutUrl
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
    // Verify webhook signature from LemonSqueezy
    const signature = req.headers['x-signature'];
    if (!signature) {
      console.warn('Missing webhook signature');
      return res.status(401).json({ error: 'Missing signature' });
    }
    
    // Verify the signature
    const rawBody = JSON.stringify(req.body);
    const isSignatureValid = verifyWebhookSignature(signature, rawBody);
    
    if (!isSignatureValid) {
      console.warn('Invalid webhook signature');
      return res.status(401).json({ error: 'Invalid signature' });
    }
    
    const { body } = req;
    const eventName = body.meta?.event_name;
    
    // Log the incoming webhook for debugging
    console.log(`Received Lemon Squeezy webhook: ${eventName}`);
    console.log('Webhook data:', JSON.stringify(body, null, 2));
    
    // Extract user ID from custom data
    let userId;
    
    // Different event types may have custom data in different locations
    if (body.data?.attributes?.custom_data?.user_id) {
      // Direct from custom_data object if it exists
      userId = body.data.attributes.custom_data.user_id;
      console.log('Found user_id in custom_data:', userId);
    } else if (body.data?.attributes?.first_order_item?.custom_data?.user_id) {
      // From first order item if available
      userId = body.data.attributes.first_order_item.custom_data.user_id;
      console.log('Found user_id in first_order_item:', userId);
    } else if (body.meta?.custom_data?.user_id) {
      // From meta custom data if available
      userId = body.meta.custom_data.user_id;
      console.log('Found user_id in meta custom_data:', userId);
    }
    
    if (!userId) {
      console.warn('No user ID found in webhook data, dumping full payload:');
      console.warn(JSON.stringify(body, null, 2));
      return res.status(200).json({ received: true, status: 'No user ID found' });
    }
    
    // Handle different webhook events
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
    
    return res.status(200).json({ received: true, status: 'processed' });
  } catch (error) {
    console.error('Webhook error:', error);
    return res.status(400).json({ message: 'Webhook error' });
  }
});

// Route to check payment status
router.get('/status', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    
    // Log environment variables for debugging
    console.log("Payment status - Environment variables:");
    console.log("CHECKOUT_ID:", process.env.LEMON_SQUEEZY_CHECKOUT_ID);
    console.log("PRODUCT_ID:", process.env.LEMON_SQUEEZY_PRODUCT_ID);
    console.log("VARIANT_ID:", process.env.LEMON_SQUEEZY_VARIANT_ID);
    
    // Generate direct checkout URL
    const directCheckoutUrl = generateLemonCheckoutUrl(req.user.id);
    console.log("Generated checkout URL with user ID:", req.user.id);
    console.log("Full checkout URL:", directCheckoutUrl);
    
    const responseData = {
      isPaid: user.isPay,
      subscriptionStatus: user.subscriptionStatus || 'none',
      checkoutId: process.env.LEMON_SQUEEZY_CHECKOUT_ID,
      productId: process.env.LEMON_SQUEEZY_PRODUCT_ID,
      variantId: process.env.LEMON_SQUEEZY_VARIANT_ID,
      userId: req.user.id,
      directCheckoutUrl
    };
    
    console.log("Sending payment status to client:", responseData);
    return res.json(responseData);
  } catch (error) {
    console.error('Error checking payment status:', error);
    return res.status(500).json({ message: 'Server error' });
  }
});

// Route for testing lemon squeezy configuration
router.get('/test-lemon-config', async (req, res) => {
  try {
    const variantId = process.env.LEMON_SQUEEZY_VARIANT_ID;
    const checkoutUrl = `https://checkout.lemonsqueezy.com/buy/${variantId}`;
    
    return res.json({
      message: 'Lemon Squeezy configuration',
      variantId: variantId,
      checkoutUrl: checkoutUrl,
      sampleUrlWithUserId: `${checkoutUrl}?checkout[custom][user_id]=test-user-id`
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

module.exports = router; 