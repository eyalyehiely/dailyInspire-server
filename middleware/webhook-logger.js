/**
 * Middleware for logging webhook requests and capturing raw body
 */
const fs = require('fs');
const path = require('path');

const webhookLogger = (req, res, next) => {
  // Only process webhook endpoints
  if (req.path.includes('/webhook')) {
    // Capture the raw body data
    let rawData = '';
    
    req.on('data', chunk => {
      rawData += chunk;
    });
    
    req.on('end', () => {
      // Store the raw body for webhook signature verification
      req.rawBody = rawData;
      
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
          rawBody: rawData,
          // The parsed body will be added by Express later
        };
        
        // Write to file
        const logFile = path.join(logDir, `webhook-${timestamp}.json`);
        fs.writeFileSync(logFile, JSON.stringify(logData, null, 2));
        
        console.log(`Webhook request logged to ${logFile}`);
        
        // Call next() inside the end event handler
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