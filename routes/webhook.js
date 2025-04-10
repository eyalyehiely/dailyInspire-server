const express = require('express');
const router = express.Router();
const { sendWelcomeEmail, sendPaymentFailedEmail, cancelSubscriptionEmail, sendPaymentMethodUpdatedEmail } = require('../controllers/user-controller');
const User = require('../models/User');
const { Paddle, EventName } = require('@paddle/paddle-node-sdk');


// Initialize Paddle SDK
const paddle = new Paddle(process.env.PADDLE_API_KEY);

// Create a `POST` endpoint to accept webhooks sent by Paddle.
router.post('/webhook', async (req, res) => {
    console.log('\n===== NEW WEBHOOK RECEIVED =====');
    
    const signature = req.headers['paddle-signature'];
    const rawRequestBody = req.rawBody;
    const secretKey = process.env.PADDLE_WEBHOOK_SECRET;

    console.log('Webhook verification details:', {
        hasSignature: !!signature,
        hasRawBody: !!rawRequestBody,
        hasSecretKey: !!secretKey,
        contentType: req.get('Content-Type'),
        headers: {
            'paddle-signature': signature,
            'content-type': req.get('Content-Type')
        },
        bodyLength: rawRequestBody ? rawRequestBody.length : 0,
        bodyPreview: rawRequestBody ? rawRequestBody.toString().substring(0, 100) : null
    });

    try {
        if (signature && rawRequestBody) {
            const eventData = await paddle.webhooks.unmarshal(rawRequestBody, secretKey, signature);
            console.log('eventData', eventData);
            const subscriptionId = eventData.data?.id;
            const customerId = eventData.data?.customer_id;
            const transactionId = eventData.data?.transaction_id;

            
            console.log('Webhook Event:', {
                type: eventData.eventType,
                subscriptionId,
                // customerId,
                // transactionId,
                // status: eventData.data?.status,
                // canceledAt: eventData.data?.canceled_at
            });

            // Helper function to find user by subscription ID or transaction ID
            const findUser = async () => {
                // First try to find by customer ID
                let user = await User.findOne({ paddleCustomerId: customerId });
                if (user) return user;

                // Then try to find by subscription ID
                user = await User.findOne({ subscriptionId: subscriptionId });
                if (user) return user;

                // Finally try to find by transaction ID if available
                if (transactionId) {
                    user = await User.findOne({ 'lastCheckoutAttempt.transactionId': transactionId });
                    if (user) return user;
                }

                return null;
            };

            switch (eventData.eventType) {
                case EventName.SubscriptionActivated:
                    console.log(`Subscription ${subscriptionId} was activated`);
                    try {
                        // Find user using the helper function
                        const user = await findUser();
                        if (!user) {
                            console.error('User not found for subscription ID:', subscriptionId);
                            // Don't return 404 here as this might be a race condition
                            return res.status(200).json({ received: true });
                        }

                        const now = new Date();
                        const nextPaymentDate = new Date(now);
                        nextPaymentDate.setMonth(nextPaymentDate.getMonth() + 1);

                        // Update user's subscription status
                        await User.findByIdAndUpdate(user._id, {
                            subscriptionStatus: 'active',
                            subscriptionId: subscriptionId,
                            isPay: true,
                            quotesEnabled: true,
                            paymentUpdatedAt: now,
                            'lastCheckoutAttempt.firstPaymentDate': now,
                            'lastCheckoutAttempt.nextPaymentDate': nextPaymentDate,
                            'lastCheckoutAttempt.timestamp': now,
                            quotesDisabledAfter: null, // Clear any previous quotes disabled date
                            paddleCustomerId: customerId // Update the Paddle customer ID
                        });

                        // Send welcome email if subscription wasn't already active
                        if (user.subscriptionStatus !== 'active') {
                            await sendWelcomeEmail(user._id);
                        }
                    } catch (error) {
                        console.error('Error processing subscription activation:', error);
                    }
                    break;

                case EventName.SubscriptionCanceled:
                    console.log(`Subscription ${subscriptionId} was cancelled at ${eventData.data?.canceled_At}`);
                    try {
                        const user = await findUser();
                        const now = new Date();

                        // Update user's subscription status
                        await User.findByIdAndUpdate(user._id, {
                            subscriptionStatus: 'canceled',
                            paymentUpdatedAt: now,
                            'lastCheckoutAttempt.canceledAt': now,
                            'lastCheckoutAttempt.timestamp': now,
                            quotesEnabled: true,
                            quotesDisabledAfter: user.lastCheckoutAttempt.nextPaymentDate
                        });
                        try {
                            await cancelSubscriptionEmail(user._id);
                        } catch (error) {
                            console.error('Error processing subscription cancellation email:', error);
                        }
                    } catch (error) {
                        console.error('Error processing subscription cancellation:', error);
                    }
                    break;

                case EventName.TransactionPaymentFailed:
                    console.log(`Transaction ${transactionId} payment failed`);
                    try {
                        // Find user by subscription ID
                        const user = await User.findOne({ subscriptionId });
                        if (!user) {
                            console.error('User not found for subscription ID:', subscriptionId);
                            return res.status(404).json({ error: 'User not found' });
                        }
                        await sendPaymentFailedEmail(user._id);
                    } catch (error) {
                        console.error('Error processing payment failure:', error);
                    }
                    break;

                case EventName.PaymentMethodSaved:
                    console.log(`Payment method saved for subscription: ${subscriptionId}`);
                    try {
                        // Find user by customer ID
                        const user = await User.findOne({ paddleCustomerId: eventData.data.customerId });
                        if (!user) {
                            console.error('User not found for customer ID:', eventData.data.customerId);
                            return res.status(404).json({ error: 'User not found' });
                        }

                        // Update user's payment method details
                        await User.findByIdAndUpdate(user._id, {
                            cardBrand: eventData.data?.payment_information?.card_brand,
                            cardLastFour: eventData.data?.payment_information?.last_four,
                            paymentUpdatedAt: new Date()
                        });

                        await sendPaymentMethodUpdatedEmail(user._id);
                    } catch (error) {
                        console.error('Error processing payment method update:', error);
                    }
                    break;

                default:
                    console.log(`Unhandled event type: ${eventData.eventType}`);
            }
        } else {
            console.error('Invalid webhook signature or missing body');
            return res.status(400).json({ error: 'Invalid webhook signature or missing body' });
        }
    } catch (error) {
        console.error('Error processing webhook:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }

    return res.status(200).json({ received: true });
});

module.exports = router;