const express = require('express');
const router = express.Router();
const nodemailer = require('nodemailer');

// Setup nodemailer for email sending
const getTransporter = () => {
  // If in production, use configured email service
  return nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    auth: {
          user: process.env.EMAIL_USER,
          pass: process.env.EMAIL_PASSWORD
        }
  });
};



// Implement rate limiting for security
const contactRequestsMap = new Map();
const MAX_REQUESTS = 5; // Max requests per timeframe
const TIMEFRAME = 60 * 60 * 1000; // 1 hour in milliseconds

const isRateLimited = (email) => {
  const now = Date.now();
  const userRequests = contactRequestsMap.get(email) || [];
  
  // Filter out requests older than TIMEFRAME
  const recentRequests = userRequests.filter(timestamp => now - timestamp < TIMEFRAME);
  
  // Update the map with recent requests
  contactRequestsMap.set(email, recentRequests);
  
  // Check if user has exceeded maximum requests
  return recentRequests.length >= MAX_REQUESTS;
};

// POST /api/contact - Handle contact form submissions
router.post('/', async (req, res) => {
  try {
    const { name, email, message } = req.body;
    
    // Validate required fields
    if (!name || !email || !message) {
      return res.status(400).json({ message: 'All fields are required' });
    }
    
    // Email format validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ message: 'Invalid email format' });
    }
    
    // Check for rate limiting
    if (isRateLimited(email)) {
      console.log(`Rate limit exceeded for contact from ${email}`);
      return res.status(429).json({ 
        message: 'Too many contact requests. Please try again later.'
      });
    }
    
    // Update the rate limiter
    const userRequests = contactRequestsMap.get(email) || [];
    contactRequestsMap.set(email, [...userRequests, Date.now()]);
    
    // Create email content
    const emailContent = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
        <h2>New Contact Form Submission</h2>
        
        <div style="margin: 20px 0;">
          <p><strong>Name:</strong> ${name}</p>
          <p><strong>Email:</strong> ${email}</p>
        </div>
        
        <div style="background-color: #f8f9fa; padding: 15px; border-radius: 8px; margin: 20px 0;">
          <h3 style="margin-top: 0; color: #333;">Message:</h3>
          <p>${message.replace(/\n/g, '<br>')}</p>
        </div>
      </div>
    `;
    
    // Configure email options
    const mailOptions = {
      from: process.env.EMAIL_FROM || `Contact Form <${process.env.EMAIL_USER}>`,
      to: process.env.EMAIL_USER,
      subject: `Contact Form: Message from ${name}`,
      html: emailContent,
      replyTo: email // Set reply-to to the sender's email
    };
    
    // Send the email
    try {
      const transporter = getTransporter();
      console.log('Sending contact form email with config:', {
        host: process.env.EMAIL_HOST,
        user: process.env.EMAIL_USER,
        hasPassword: !!process.env.EMAIL_PASSWORD,
        environment: process.env.NODE_ENV
      });
      
      await transporter.sendMail(mailOptions);
      console.log(`Contact form submission from ${name} (${email}) sent successfully`);
      
      return res.status(200).json({ 
        message: 'Message sent successfully! We\'ll get back to you soon.'
      });
    } catch (emailError) {
      console.error('Error sending contact form email:', emailError);
      return res.status(500).json({ 
        message: 'Failed to send message. Please try again later.',
        error: emailError.message
      });
    }
  } catch (error) {
    console.error('Error in contact form handler:', error);
    return res.status(500).json({ 
      message: 'Internal server error',
      error: error.message
    });
  }
});

module.exports = router; 