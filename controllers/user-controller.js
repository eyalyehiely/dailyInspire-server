const nodemailer = require('nodemailer');
const User = require('../models/User');
const { paddleApi } = require('../controllers/paddle-controller');

// Function to send welcome email after signup
const sendWelcomeEmail = async (user_id) => {
  try {
    console.log('Preparing to send welcome email to:', user_id);
    
    // First, find the user by email to get all user data
    const user = await User.findOne({ _id: user_id });
    if (!user) {
      console.error('User not found for email:', user_id);
      return;
    }

    console.log('Found user:', {
      email: user.email,
      timezone: user.timezone,
      preferredTime: user.preferredTime,
      isPay: user.isPay
    });

    console.log('Email configuration:', {
      service: process.env.EMAIL_SERVICE || 'gmail',
      user: process.env.EMAIL_USER ? 'Set' : 'Not set',
      password: process.env.EMAIL_PASSWORD ? 'Set' : 'Not set',
      from: process.env.EMAIL_FROM || `Daily Inspirational Quotes <${process.env.EMAIL_USER}>`
    });
    
    const transporter = nodemailer.createTransport({
      service: process.env.EMAIL_SERVICE || 'gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASSWORD
      }
    });

    // Sample quote to give them a preview
    const sampleQuote = {
      text: "The journey of a thousand miles begins with one step.",
      author: "Lao Tzu"
    };

    // Format the preferred time for display
    const timeFormat = new Intl.DateTimeFormat('en', {
      hour: 'numeric',
      minute: 'numeric',
      hour12: true,
      timeZone: user.timezone || 'UTC'
    });
    const formattedTime = timeFormat.format(new Date(`2000-01-01T${user.preferredTime || '09:00'}`));

    // Check if this is a subscription welcome email
    const isSubscriptionWelcome = user.isPay === true;
    const emailSubject = isSubscriptionWelcome 
      ? 'Welcome to Daily Inspirational Quotes Premium!' 
      : 'Welcome to Daily Inspirational Quotes!';
    
    
    const subscriptionInfo = isSubscriptionWelcome 
      ? `<div style="background-color: #e6f7ff; padding: 15px; border-radius: 8px; margin: 20px 0;">
          <h3 style="margin-top: 0; color: #0066cc;">Premium Subscription Activated</h3>
          <p>Thank you for subscribing to our premium service! Your account has been upgraded and you now have access to all premium features.</p>
          <p><strong>Subscription Status:</strong> Active</p>
          <p><strong>Subscription ID:</strong> ${user.subscriptionId || 'N/A'}</p>

        </div>` 
      : '';

    const mailOptions = {
      from: process.env.EMAIL_FROM || `Daily Inspirational Quotes <${process.env.EMAIL_USER}>`,
      to: user.email,
      subject: emailSubject,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
          <h2>Welcome to Daily Inspirational Quotes, ${user.first_name || user.email}!</h2>
          
          <p>Thank you for signing up for our daily quote service. Your account has been successfully created!</p>
          
          ${subscriptionInfo}
          
          <div style="background-color: #f8f9fa; padding: 15px; border-radius: 8px; margin: 20px 0;">
            <h3 style="margin-top: 0; color: #333;">Your Preferences</h3>
            <p><strong>Daily Quote Time:</strong> ${formattedTime}</p>
            <p><strong>Timezone:</strong> ${user.timezone || 'UTC'}</p>
          </div>
          
          <p>Starting tomorrow, you'll receive a new inspirational quote every day at your preferred time.</p>
          
          <div style="margin: 30px 0;">
            <h3>Here's a preview of what to expect:</h3>
            <blockquote style="border-left: 4px solid #ccc; padding: 10px 15px; font-style: italic; margin: 15px 0;">
              "${sampleQuote.text}"
            </blockquote>
            <p style="text-align: right;">— ${sampleQuote.author}</p>
          </div>
          
          <p>We hope these daily quotes will bring inspiration and motivation to your day!</p>
          <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee;">
            <p style="color: #666; font-size: 14px;">This is an automated notification from DailyInspire.</p>
          </div>
        </div>
      `
    };

    console.log('Sending welcome email to:', user.email);
    const info = await transporter.sendMail(mailOptions);
    console.log(`Welcome email sent successfully to ${user.email}. Message ID: ${info.messageId}`);
    return info;
  } catch (error) {
    console.error('Error sending welcome email:', error);
    console.error('Error details:', {
      message: error.message,
      code: error.code,
      command: error.command,
      response: error.response,
      responseCode: error.responseCode,
      stack: error.stack
    });
    // Don't throw - we don't want to break the signup process if email fails
  }
};

const sendEmailToOwner = async (user) => {
  try {
    const transporter = nodemailer.createTransport({
      service: process.env.EMAIL_SERVICE || 'gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASSWORD
      }
    });

    // Format the preferred time for display
    const timeFormat = new Intl.DateTimeFormat('en', {
      hour: 'numeric',
      minute: 'numeric',
      hour12: true,
      timeZone: user.timezone || 'UTC'
    });
    const formattedTime = timeFormat.format(new Date(`2000-01-01T${user.preferredTime || '09:00'}`));

    const mailOptions = {
      from: process.env.EMAIL_FROM || `Daily Inspirational Quotes <${process.env.EMAIL_USER}>`,
      to: process.env.OWNER_EMAIL, // Send to owner's email
      subject: 'New User Signup - Daily Inspirational Quotes',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
          <h2>New User Signup!</h2>
          
          <p>A new user has signed up for Daily Inspirational Quotes.</p>
          
          <div style="background-color: #f8f9fa; padding: 15px; border-radius: 8px; margin: 20px 0;">
            <h3 style="margin-top: 0; color: #333;">User Details</h3>
            <p><strong>Name:</strong> ${user.first_name}</p>
            <p><strong>Email:</strong> ${user.email}</p>
            <p><strong>Daily Quote Time:</strong> ${formattedTime}</p>
            <p><strong>Timezone:</strong> ${user.timezone || 'UTC'}</p>
            <p><strong>Signup Date:</strong> ${new Date().toLocaleString()}</p>
          </div>
        </div>
      `
    };

    await transporter.sendMail(mailOptions);
    console.log(`Notification email sent to owner about new user: ${user.email}`);
  } catch (error) {
    console.error('Error sending notification email to owner:', error);
    // Don't throw - we don't want to break the signup process if email fails
  }
};

// Send sorry email to user that cancel his subscription
const sendPaymentFailedEmail = async (user_id) => {
  try {
    const user = await User.findOne({ _id: user_id });
    if (!user) {
      console.error('User not found for ID:', user_id);
      return;
    }

    const transporter = nodemailer.createTransport({
      service: process.env.EMAIL_SERVICE || 'gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASSWORD
      }
    });

    // Send email to user
    const userMailOptions = {
      from: process.env.EMAIL_FROM || `Daily Inspirational Quotes <${process.env.EMAIL_USER}>`,
      to: user.email,
      subject: 'Sorry, we couldn\'t process your payment',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
          <h2>Sorry, we couldn't process your payment</h2>
          <p>We're sorry to inform you that we couldn't process your payment. Please try again using a different payment method.</p>
          <p>If you continue to experience issues, please contact our support team for assistance.</p>
          <p>You can reach us at <a href="mailto:support@dailyinspire.xyz">support@dailyinspire.xyz</a></p>
          <p>Thank you for your understanding.</p>
        </div>
      `
    };

    // Send email to owner
    const ownerMailOptions = {
      from: process.env.EMAIL_FROM || `Daily Inspirational Quotes <${process.env.EMAIL_USER}>`,
      to: process.env.OWNER_EMAIL,
      subject: 'Payment Failed - Daily Inspirational Quotes',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
          <h2>Payment Failed Notification</h2>
          <p>A payment attempt has failed for one of your users.</p>
          
          <div style="background-color: #f8f9fa; padding: 15px; border-radius: 8px; margin: 20px 0;">
            <h3 style="margin-top: 0; color: #333;">User Details</h3>
            <p><strong>Name:</strong> ${user.first_name}</p>
            <p><strong>Email:</strong> ${user.email}</p>
            <p><strong>Date:</strong> ${new Date().toLocaleString()}</p>
          </div>
        </div>
      `
    };

    // Send both emails
    await Promise.all([
      transporter.sendMail(userMailOptions),
      transporter.sendMail(ownerMailOptions)
    ]);
    
    console.log(`Payment failed emails sent to user: ${user.email} and owner`);
  } catch (error) {
    console.error('Error sending payment failed emails:', error);
    // Don't throw - we don't want to break the process if email fails
  }
};


const cancelSubscriptionEmail = async (user_id, billingPeriodEnd) => {
  try {
    const user = await User.findOne({ _id: user_id });
    if (!user) {
      console.error('User not found for ID:', user_id);
      return;
    }

    if (!billingPeriodEnd || isNaN(billingPeriodEnd.getTime())) {
      console.error('Invalid billing period end date provided:', billingPeriodEnd);
      return;
    }

    const formattedEndDate = billingPeriodEnd.toLocaleDateString('he-IL', { 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric' 
    });

    const transporter = nodemailer.createTransport({
      service: process.env.EMAIL_SERVICE || 'gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASSWORD
      }
    });

    const mailOptions = {
      from: process.env.EMAIL_FROM || `Daily Inspirational Quotes <${process.env.EMAIL_USER}>`,
      to: user.email,
      subject: 'Subscription Canceled - Daily Inspirational Quotes',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
          <h2>Subscription Canceled</h2>
          <p>We regret to inform you that your subscription has been canceled.</p>
          <p>You will continue to have access to all premium features until ${formattedEndDate}.</p>
          <p>After this date, you will no longer receive daily inspirational quotes.</p>
          <p>If you have any questions or need assistance, please contact our support team.</p>
          <p>Thank you for your understanding.</p>
          <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee;">
            <p style="color: #666; font-size: 14px;">This is an automated notification from DailyInspire.</p>
          </div>
        </div>
      `
    };

    await transporter.sendMail(mailOptions);
    console.log(`Cancel subscription email sent to user: ${user.email}`);
  } catch (error) {
    console.error('Error sending cancel subscription email:', error);
  }
};

const sendPaymentMethodUpdatedEmail = async (user_id) => {
  try {
    const user = await User.findOne({ _id: user_id });
    if (!user) {
      console.error('User not found for ID:', user_id); 
      return;
    }

    const transporter = nodemailer.createTransport({
      service: process.env.EMAIL_SERVICE || 'gmail',
      auth: { 
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASSWORD
      }
    });

    const mailOptions = {
      from: process.env.EMAIL_FROM || `Daily Inspirational Quotes <${process.env.EMAIL_USER}>`, 
      to: user.email,
      subject: 'Payment Method Updated - Daily Inspirational Quotes',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
          <h2>Payment Method Updated</h2>
          <p>We have updated your payment method.</p> 
          <p>Your new payment method is ${user.cardBrand} ending in ${user.cardLastFour}.</p>
          <p>If you have any questions or need assistance, please contact our support team.</p>
          <p>Thank you for your understanding.</p>
          <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee;">
            <p style="color: #666; font-size: 14px;">This is an automated notification from DailyInspire.</p>
          </div>
        </div>    
      `
    };

    await transporter.sendMail(mailOptions);
    console.log(`Payment method updated email sent to user: ${user.email}`);
  } catch (error) {
    console.error('Error sending payment method updated email:', error);
  }
};

// Export the functions
module.exports = {
  sendWelcomeEmail,
  sendEmailToOwner,
  sendPaymentFailedEmail,
  cancelSubscriptionEmail
}; 