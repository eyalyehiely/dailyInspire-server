const express = require('express');
const router = express.Router();
const User = require('../models/User')
const { fetchDailyQuote, sendQuoteEmail } = require('../controllers/quote-sender');

//testing send quote to user
router.post('/send-quote', async (req, res) => {
    try {
        const email = req.body.email;
        const quote = await fetchDailyQuote();
        await sendQuoteEmail(email, quote);

        res.status(200).json({ message: 'Quote sent successfully' });
    } catch (error) {
        console.error('Error sending quotes:', error);
        res.status(500).json({ message: 'Error sending quotes' });
    }
});




// Test endpoint for email functionality
router.post('/test-emails', auth, async (req, res) => {
    try {
      console.log('Testing email functionality');
      
      // Get the current user
      const user = await User.findById(req.user.id);
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }
      
      // Test welcome email
      let welcomeEmailResult = null;
      try {
        console.log('Testing welcome email...');
        welcomeEmailResult = await sendWelcomeEmail(user);
        console.log('Welcome email test result:', welcomeEmailResult);
      } catch (error) {
        console.error('Error testing welcome email:', error);
      }
      
      // Test receipt email
      let receiptEmailResult = null;
      try {
        console.log('Testing receipt email...');
        receiptEmailResult = await sendReceiptEmail(user, { orderId: 'TEST-ORDER-' + Date.now() });
        console.log('Receipt email test result:', receiptEmailResult);
      } catch (error) {
        console.error('Error testing receipt email:', error);
      }
      
      return res.json({
        success: true,
        message: 'Email tests completed',
        welcomeEmail: welcomeEmailResult ? 'Sent successfully' : 'Failed to send',
        receiptEmail: receiptEmailResult ? 'Sent successfully' : 'Failed to send',
        user: {
          id: user._id,
          email: user.email,
          isPay: user.isPay,
          subscriptionStatus: user.subscriptionStatus
        }
      });
    } catch (error) {
      console.error('Error testing emails:', error);
      return res.status(500).json({ error: error.message });
    }
  });
  
module.exports = router;
