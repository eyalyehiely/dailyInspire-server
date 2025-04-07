const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port: 587,
    secure: false, // true for 465, false for other ports
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASSWORD
    },
    pool: true, // Enable connection pooling
    maxConnections: 5, // Maximum number of connections in the pool
    maxMessages: 100, // Maximum number of messages per connection
    rateDelta: 1000, // Time in ms between connection attempts
    rateLimit: 5, // Maximum number of messages per second
    tls: {
      ciphers: 'SSLv3',
      rejectUnauthorized: true // Enable proper certificate validation
    }
});

// Verify the transporter configuration
transporter.verify(function(error, success) {
    if (error) {
        console.error('SMTP Connection Error:', error);
    } else {
        console.log('SMTP Server is ready to send emails');
    }
});

module.exports = transporter;