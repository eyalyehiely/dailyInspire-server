/**
 * Middleware for logging webhook requests
 */
const fs = require('fs');
const path = require('path');

const webhookLogger = (req, res, next) => {
  // Only log requests to webhook endpoints
  if (req.path.includes('/webhook')) {
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
        body: req.body
      };
      
      // Write to file
      const logFile = path.join(logDir, `webhook-${timestamp}.json`);
      fs.writeFileSync(logFile, JSON.stringify(logData, null, 2));
      
      console.log(`Webhook request logged to ${logFile}`);
    } catch (error) {
      console.error('Error logging webhook:', error);
    }
  }
  
  // Continue processing the request
  next();
};

module.exports = webhookLogger; 