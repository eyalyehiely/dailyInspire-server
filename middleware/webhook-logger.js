/**
 * Middleware for logging webhook requests and capturing raw body
 */
const fs = require('fs');
const path = require('path');
const getRawBody = require('raw-body');

const webhookLogger = (req, res, next) => {
  // Only process webhook endpoints
  if (req.path.includes('/webhook')) {
    // Get the raw body
    getRawBody(req, {
      length: req.headers['content-length'],
      limit: '1mb',
      encoding: 'utf8'
    }, function(err, string) {
      if (err) {
        console.error('Error reading raw body:', err);
        return next(err);
      }

      // Store the raw body for webhook signature verification
      req.rawBody = string;
      
      try {
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
          rawBody: string,
          // The parsed body will be added by Express later
        };
        
        // Write to file
        const logFile = path.join(logDir, `webhook-${timestamp}.json`);
        fs.writeFileSync(logFile, JSON.stringify(logData, null, 2));
        
        console.log(`Webhook request logged to ${logFile}`);
        
        // Call next() inside the callback
        next();
      } catch (error) {
        console.error('Error logging webhook:', error);
        next(error);
      }
    });
  } else {
    // For non-webhook routes, just continue
    next();
  }
};

module.exports = webhookLogger; 