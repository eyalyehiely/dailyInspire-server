const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const User = require('../models/User');
const { 
  verifyWebhookSignature, 
  sendReceiptEmail, 
  processSuccessfulPayment 
} = require('../controllers/payment-controller');
const { sendWelcomeEmail } = require('../controllers/user-controller');

// Route to get payment page information
router.get('/checkout-info', auth, async (req, res) => {
  try {
    // Check if user is already paid
    const user = await User.findById(req.user.id);
    if (user.isPay) {
      return res.json({ isPaid: true, message: 'You already have premium access' });
    }
    
    // Return Lemon Squeezy checkout information
    // - For overlay checkout use checkoutId (preferred method)
    // - For redirect checkout use checkoutUrl
    return res.json({
      isPaid: false,
      checkoutId: process.env.LEMON_SQUEEZY_CHECKOUT_ID,
      productId: process.env.LEMON_SQUEEZY_PRODUCT_ID,
      variantId: process.env.LEMON_SQUEEZY_VARIANT_ID,
      userId: req.user.id
    });
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
    
    // Extract user ID from custom data (ensure this is passed during checkout)
    let userId;
    if (body.data?.attributes?.custom_data) {
      userId = body.data.attributes.custom_data.user_id;
    }
    
    if (!userId) {
      console.warn('No user ID found in webhook data');
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
    return res.json({ 
      isPaid: user.isPay,
      subscriptionStatus: user.subscriptionStatus || 'none'
    });
  } catch (error) {
    console.error('Error checking payment status:', error);
    return res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router; 