const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const User = require('../models/User');
const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer');

// Setup nodemailer for email sending
const getTransporter = () => {
  // If in production, use configured email service
    return nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true, // use SSL
      auth: {
          user: process.env.EMAIL_USER,
          pass: process.env.EMAIL_PASSWORD
        }
      });
  } 
  

// Implement rate limiting for security
const resetRequestsMap = new Map();
const MAX_REQUESTS = 3; // Max requests per timeframe
const TIMEFRAME = 60 * 60 * 1000; // 1 hour in milliseconds

const isRateLimited = (email) => {
  const now = Date.now();
  const userRequests = resetRequestsMap.get(email) || [];
  
  // Filter requests within the timeframe
  const recentRequests = userRequests.filter(time => now - time < TIMEFRAME);
  
  // Update the map with recent requests
  resetRequestsMap.set(email, recentRequests);
  
  // Check if rate limit exceeded
  return recentRequests.length >= MAX_REQUESTS;
};

// Route to request password reset
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    
    if (!email) {
      return res.status(400).json({ message: 'Email is required' });
    }
    
    // Rate limiting check (for security)
    if (isRateLimited(email)) {
      console.log(`Rate limit exceeded for ${email}`);
      return res.status(429).json({ 
        message: 'Too many password reset requests. Please try again later.' 
      });
    }
    
    // Add this request to rate limiting tracker
    const userRequests = resetRequestsMap.get(email) || [];
    resetRequestsMap.set(email, [...userRequests, Date.now()]);
    
    // Find user with this email
    const user = await User.findOne({ email });
    
    // Even if no user is found, we return success for security reasons
    // This prevents email enumeration attacks
    if (!user) {
      return res.status(200).json({ 
        message: 'If an account with that email exists, a password reset link has been sent to your email.'
      });
    }
    
    // Generate token
    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetTokenExpires = Date.now() + 3600000; // 1 hour from now
    
    // Update user with reset token
    user.resetPasswordToken = resetToken;
    user.resetPasswordExpires = resetTokenExpires;
    await user.save();
    
    // Create reset URL
    const clientURL = process.env.VITE_CLIENT_URL || 'http://localhost:3000';
    const resetURL = `${clientURL}/reset-password/${resetToken}`;
    
    // Create email content
    const emailContent = `
      <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { text-align: center; margin-bottom: 20px; }
            .button { display: inline-block; background-color: #4f46e5; color: white; text-decoration: none; padding: 10px 20px; border-radius: 5px; margin: 20px 0; }
            .footer { margin-top: 30px; font-size: 12px; color: #666; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>Reset Your Password</h1>
            </div>
            <p>Hello ${user.first_name},</p>
            <p>We received a request to reset your password for your DailyInspire account.</p>
            <p>Please click the button below to reset your password. This link will expire in 1 hour.</p>
            <p style="text-align: center;">
              <a href="${resetURL}" class="button">Reset Password</a>
            </p>
            <p>If you did not request a password reset, please ignore this email or contact our support team if you have concerns.</p>
            <p>If the button doesn't work, you can also copy and paste this URL into your browser:</p>
            <p>${resetURL}</p>
            <div class="footer">
              <p>Best regards,</p>
              <p>The DailyInspire Team</p>
            </div>
          </div>
        </body>
      </html>
    `;
    
    // Configure email options
    const mailOptions = {
      from: process.env.EMAIL_FROM || 'DailyInspire <noreply@dailyinspire.com>',
      to: user.email,
      subject: 'DailyInspire - Password Reset',
      html: emailContent
    };
    
    // Send the email
    try {
      const transporter = getTransporter();
      console.log('Email transport configured with:', {
        service: process.env.EMAIL_SERVICE,
        user: process.env.EMAIL_USER,
        hasPassword: !!process.env.EMAIL_PASSWORD,
        environment: process.env.NODE_ENV
      });
      await transporter.sendMail(mailOptions);
      console.log(`Password reset email sent to ${user.email}`);
    } catch (emailError) {
      // Log email error but don't expose to client (security)
      console.error('Error sending password reset email:', emailError);
    }
    
    // Standard response regardless of email success (for security)
    return res.status(200).json({ 
      message: 'If an account with that email exists, a password reset link has been sent to your email.'
    });
    
  } catch (error) {
    console.error('Password reset error:', error);
    res.status(500).json({ message: 'An error occurred. Please try again later.' });
  }
});

// Route to validate reset token
router.get('/reset-password/validate/:token', async (req, res) => {
  try {
    const { token } = req.params;
    
    if (!token) {
      return res.status(400).json({ message: 'Token is required' });
    }
    
    // Find user with this token and make sure it hasn't expired
    const user = await User.findOne({
      resetPasswordToken: token,
      resetPasswordExpires: { $gt: Date.now() }
    });
    
    if (!user) {
      return res.status(400).json({ message: 'Password reset link is invalid or has expired' });
    }
    
    res.status(200).json({ message: 'Password reset link is valid' });
    
  } catch (error) {
    console.error('Token validation error:', error);
    res.status(500).json({ message: 'An error occurred. Please try again later.' });
  }
});

// Route to reset password with token
router.post('/reset-password', async (req, res) => {
  try {
    const { token, newPassword } = req.body;
    
    if (!token || !newPassword) {
      return res.status(400).json({ message: 'Token and new password are required' });
    }
    
    // Validate password strength
    if (newPassword.length < 8) {
      return res.status(400).json({ message: 'Password must be at least 8 characters' });
    }
    
    // Ensure password has some complexity
    const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;
    if (!passwordRegex.test(newPassword)) {
      return res.status(400).json({ 
        message: 'Password must include at least one uppercase letter, one lowercase letter, and one number' 
      });
    }
    
    // Find user with this token and make sure it hasn't expired
    const user = await User.findOne({
      resetPasswordToken: token,
      resetPasswordExpires: { $gt: Date.now() }
    });
    
    if (!user) {
      return res.status(400).json({ message: 'Password reset link is invalid or has expired' });
    }
    
    // Hash new password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);
    
    // Update user
    user.password = hashedPassword;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    await user.save();
    
    // Send confirmation email
    try {
      const emailContent = `
        <html>
          <head>
            <style>
              body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
              .container { max-width: 600px; margin: 0 auto; padding: 20px; }
              .header { text-align: center; margin-bottom: 20px; }
              .alert { color: #721c24; background-color: #f8d7da; padding: 10px; border-radius: 5px; }
              .footer { margin-top: 30px; font-size: 12px; color: #666; }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="header">
                <h1>Password Changed Successfully</h1>
              </div>
              <p>Hello ${user.first_name},</p>
              <p>Your password has been changed successfully.</p>
              <p class="alert">If you did not request this change, please contact our support team immediately as your account may have been compromised.</p>
              <div class="footer">
                <p>Best regards,</p>
                <p>The DailyInspire Team</p>
              </div>
            </div>
          </body>
        </html>
      `;
      
      const mailOptions = {
        from: process.env.EMAIL_FROM || 'DailyInspire <noreply@dailyinspire.com>',
        to: user.email,
        subject: 'DailyInspire - Password Changed Successfully',
        html: emailContent
      };
      
      const transporter = getTransporter();
      await transporter.sendMail(mailOptions);
      console.log(`Password change confirmation email sent to ${user.email}`);
    } catch (emailError) {
      // Log email error but don't expose to client
      console.error('Error sending password change confirmation email:', emailError);
    }
    
    res.status(200).json({ message: 'Your password has been reset successfully' });
    
  } catch (error) {
    console.error('Password reset error:', error);
    res.status(500).json({ message: 'An error occurred. Please try again later.' });
  }
});

module.exports = router; 