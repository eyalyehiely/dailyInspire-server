require('dotenv').config(); // Load environment variables
const axios = require('axios');
const nodemailer = require('nodemailer');
const User = require('../models/User');
const { DateTime } = require('luxon'); // We'll need to add this dependency
const { isQuoteSentToday, updateQuoteStatus } = require('../utils/quoteStatus');

// Function to get a quote from the API
async function fetchDailyQuote() {
  try {
    // Using zenquotes.io API as configured in your .env
    const response = await axios.get(process.env.QUOTE_API_URL);
    
    // ZenQuotes returns an array with one quote object
    const quoteData = response.data[0];
    return {
      text: quoteData.q,
      author: quoteData.a
    };
  } catch (error) {
    console.error('Error fetching quote:', error);
    return { 
      text: "The best preparation for tomorrow is doing your best today.",
      author: "H. Jackson Brown Jr." 
    }; // Fallback quote
  }
}

// Function to send email to a user
async function sendQuoteEmail(email, quote) {
  const transporter = nodemailer.createTransport({
    host: 'smtp.office365.com',
    port: 587,
    secure: false, // true for 465, false for other ports
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASSWORD
    },
    tls: {
      ciphers: 'SSLv3',
      rejectUnauthorized: false
    }
  });

  const mailOptions = {
    from: process.env.EMAIL_FROM || `Daily Inspiration <${process.env.EMAIL_USER}>`,
    to: email,
    subject: 'Your Daily Inspiration',
    html: `
      <div style="font-family: 'Helvetica Neue', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 30px 20px; background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
        <div style="text-align: center; margin-bottom: 30px;">
          <h1 style="color: #4F46E5; font-size: 24px; margin: 0; font-weight: 600;">Your Daily Inspiration</h1>
          <div style="width: 50px; height: 3px; background: linear-gradient(to right, #4F46E5, #9181F4); margin: 15px auto;"></div>
        </div>
        
        <div style="background-color: #f8f9fa; padding: 30px; border-radius: 6px; margin-bottom: 25px;">
          <blockquote style="border-left: 3px solid #4F46E5; padding-left: 20px; margin: 0; font-style: italic; font-size: 18px; line-height: 1.5; color: #333;">
            "${quote.text}"
          </blockquote>
          <p style="text-align: right; margin-top: 15px; font-size: 16px; color: #666; font-weight: 500;">— ${quote.author}</p>
        </div>
        
        <div style="margin-top: 20px; text-align: center; padding-top: 20px; border-top: 1px solid #eee; color: #666; font-size: 14px;">
          <p style="margin: 0 0 10px 0;">Brought to you by DailyInspire</p>
          <p style="margin: 0;">
            <a href="https://app.dailyinspire.xyz" style="color: #4F46E5; text-decoration: none; margin: 0 10px;">Our Website</a> |
            <a href="mailto:support@dailyinspire.xyz" style="color: #4F46E5; text-decoration: none; margin: 0 10px;">Contact Support</a>
          </p>
          <p style="margin: 15px 0 0 0; font-size: 12px; color: #999;">
            © ${new Date().getFullYear()} DailyInspire. All rights reserved.
          </p>
        </div>
      </div>
    `
  };

  

  try {
    await transporter.sendMail(mailOptions);
    console.log(`Quote sent successfully to ${email}`);
  } catch (error) {
    console.error(`Failed to send email to ${email}:`, error);
  }
}



// Function to send email to a user
async function sendSignUpEmail(email, quote) {
  const transporter = nodemailer.createTransport({
    service: process.env.EMAIL_SERVICE,
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASSWORD
    }
  });

  const mailOptions = {
    from: process.env.EMAIL_FROM || `Daily Inspiration <${process.env.EMAIL_USER}>`,
    to: email,
    subject: 'Thank you for signing up!',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2>Thank you for signing up!</h2>
        <p>We're excited to have you on board. We'll be sending you a daily quote every day at your preferred time.</p>
        <p>If you have any questions or need assistance, please don't hesitate to contact us.</p>
        <p>Thank you for choosing our service!</p>
        <p>The Daily Quote Team</p>
      </div>
    `
  };

  

  try {
    await transporter.sendMail(mailOptions);
    console.log(`Quote sent successfully to ${email}`);
  } catch (error) {
    console.error(`Failed to send email to ${email}:`, error);
  }
}

// Function to send quotes to users who should receive them at the current time
async function sendQuotesToUsersForCurrentTime() {
  try {
    // Get the current time in UTC
    const now = DateTime.now().setZone('UTC');
    const currentHour = now.hour;
    const currentMinute = now.minute;
    
    // Find all users who should receive quotes at this time
    // based on their timezone and preferred time
    const users = await User.find({ quotesEnabled: true });
    
    // Filter users who should receive quotes now
    const usersToReceiveQuotes = users.filter(user => {
      try {
        // Get the user's local time
        const userLocalTime = DateTime.now().setZone(user.timezone);
        const userPreferredHour = parseInt(user.preferredTime.split(':')[0]);
        const userPreferredMinute = parseInt(user.preferredTime.split(':')[1]);
        
        // Check if it's time to send a quote to this user
        // (match hour and minute is within a 1-minute window)
        return userLocalTime.hour === userPreferredHour && 
               userLocalTime.minute === userPreferredMinute;
      } catch (error) {
        console.error(`Error processing user ${user.email} timezone:`, error);
        return false;
      }
    });
    
    if (usersToReceiveQuotes.length > 0) {
      console.log(`Found ${usersToReceiveQuotes.length} users who should receive quotes now.`);
      
      // Fetch a quote once for all users
      const quote = await fetchDailyQuote();
      
      // Send the quote to each user
      const sendPromises = usersToReceiveQuotes.map(async user => {
        // Check if quote was already sent today
        const wasSentToday = await isQuoteSentToday(user._id);
        if (wasSentToday) {
          console.log(`Skipping quote send for ${user.email} - already sent today`);
          return;
        }
        
        // Send the quote
        await sendQuoteEmail(user.email, quote);
        
        // Update the quote status
        await updateQuoteStatus(user._id, true);
        console.log(`Quote sent to ${user.email} and status updated`);
      });
      
      await Promise.all(sendPromises);
      console.log(`Sent quotes to ${usersToReceiveQuotes.length} users.`);
    }
  } catch (error) {
    console.error('Error in time-based quote sending process:', error);
  }
}

// Legacy function for manual sending to all users
async function sendQuotesToAllUsers() {
  try {
    // Fetch quote of the day
    const quote = await fetchDailyQuote();
    
    // Get all user emails who have quotes enabled
    const userDocs = await User.find({ quotesEnabled: true }, 'email');
    const userEmails = userDocs.map(user => user.email);
    
    // Send quote to each user
    console.log(`Sending quote to ${userEmails.length} users...`);
    
    const sendPromises = userEmails.map(email => 
      sendQuoteEmail(email, quote)
    );
    
    await Promise.all(sendPromises);
    console.log('Daily quote sending complete!');
  } catch (error) {
    console.error('Error in quote sending process:', error);
  }
}

// Export both functions
module.exports = { 
  sendQuotesToAllUsers,
  sendQuotesToUsersForCurrentTime,
  fetchDailyQuote,
  sendQuoteEmail
};

// If run directly (for testing)
if (require.main === module) {
  sendQuotesToUsersForCurrentTime();
} 
