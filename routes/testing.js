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

module.exports = router;
