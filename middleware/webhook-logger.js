/**
 * Middleware for logging webhook requests and capturing raw body
 */
const fs = require('fs');
const path = require('path');

const webhookLogger = (req, res, next) => {
  // Only process webhook endpoints
  if (req.path.includes('/webhook')) {
    // Create a buffer to store the raw body
    const chunks = [];
    
    // Listen for data events
    req.on('data', chunk => {
      chunks.push(chunk);
    });
    
    // When all data is received
    req.on('end', () => {
      try {
        // Combine chunks into a single buffer
        const rawBody = Buffer.concat(chunks).toString('utf8');
        
        // Store the raw body for webhook signature verification
        req.rawBody = rawBody;
        
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
          rawBody: rawBody
        };
        
        // Write to file
        const logFile = path.join(logDir, `webhook-${timestamp}.json`);
        fs.writeFileSync(logFile, JSON.stringify(logData, null, 2));
        
        console.log(`Webhook request logged to ${logFile}`);
        
        // Parse the body for the next middleware
        try {
          req.body = JSON.parse(rawBody);
        } catch (parseError) {
          console.error('Error parsing webhook body:', parseError);
        }
        
        next();
      } catch (error) {
        console.error('Error in webhook logger:', error);
        next(error);
      }
    });
    
    // Handle errors
    req.on('error', error => {
      console.error('Error reading webhook request:', error);
      next(error);
    });
  } else {
    // For non-webhook routes, just continue
    next();
  }
};

module.exports = webhookLogger; 