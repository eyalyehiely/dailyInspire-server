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
      console.error('Webhook request timeout');
      res.status(408).json({ error: 'Request timeout' });
    }, 10000); // 10 seconds timeout
    
    // Create a buffer to store the raw body
    const chunks = [];
    let totalLength = 0;
    
    // Listen for data events
    req.on('data', chunk => {
      chunks.push(chunk);
      totalLength += chunk.length;
      
      // Check if the body is too large
      if (totalLength > 1e6) { // 1MB limit
        clearTimeout(timeout);
        console.error('Webhook request body too large');
        res.status(413).json({ error: 'Request body too large' });
        req.destroy();
      }
    });
    
    // When all data is received
    req.on('end', () => {
      clearTimeout(timeout);
      
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
          rawBody: rawBody,
          ip: req.ip,
          userAgent: req.get('user-agent')
        };
        
        // Write to file
        const logFile = path.join(logDir, `webhook-${timestamp}.json`);
        fs.writeFileSync(logFile, JSON.stringify(logData, null, 2));
        
        console.log(`Webhook request logged to ${logFile}`);
        console.log('Request body length:', totalLength);
        
        // Parse the body for the next middleware
        try {
          req.body = JSON.parse(rawBody);
          console.log('Successfully parsed webhook body');
        } catch (parseError) {
          console.error('Error parsing webhook body:', parseError);
          // Don't fail here, let the webhook handler deal with it
        }
        
        next();
      } catch (error) {
        console.error('Error in webhook logger:', error);
        next(error);
      }
    });
    
    // Handle errors
    req.on('error', error => {
      clearTimeout(timeout);
      console.error('Error reading webhook request:', error);
      next(error);
    });
  } else {
    // For non-webhook routes, just continue
    next();
  }
};

module.exports = webhookLogger; 