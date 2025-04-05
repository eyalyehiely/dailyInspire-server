/**
 * Middleware for logging webhook requests and capturing raw body
 */
const fs = require('fs');
const path = require('path');

const webhookLogger = (req, res, next) => {
  // Only process webhook endpoints
  if (req.path.includes('/webhook')) {
    console.log('===== WEBHOOK REQUEST RECEIVED =====');
    console.log('Path:', req.path);
    console.log('Method:', req.method);
    console.log('Headers:', JSON.stringify(req.headers, null, 2));
    
    // Set a timeout for the request
    const timeout = setTimeout(() => {
      if (!res.headersSent) {
        console.error('Webhook request timeout');
        res.status(408).json({ error: 'Request timeout' });
      }
    }, 10000); // 10 seconds timeout
    
    try {
      // Store the raw body for webhook signature verification
      req.rawBody = JSON.stringify(req.body);
      
      // Create logs directory if it doesn't exist
      const logDir = path.join(__dirname, '../logs');
      if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
      }
      
      // Create log data
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const logData = {
        timestamp,
        url: req.originalUrl,
        method: req.method,
        headers: req.headers,
        query: req.query,
        body: req.body,
        ip: req.ip,
        userAgent: req.get('user-agent')
      };
      
      // Write to file
      const logFile = path.join(logDir, `webhook-${timestamp}.json`);
      fs.writeFileSync(logFile, JSON.stringify(logData, null, 2));
      
      console.log(`Webhook request logged to ${logFile}`);
      console.log('Request body length:', req.rawBody.length);
      console.log('Successfully parsed webhook body');
      
      // Clear the timeout before proceeding
      clearTimeout(timeout);
      next();
    } catch (error) {
      // Clear the timeout in case of error
      clearTimeout(timeout);
      console.error('Error in webhook logger:', error);
      next(error);
    }
  } else {
    // For non-webhook routes, just continue
    next();
  }
};

module.exports = webhookLogger; 