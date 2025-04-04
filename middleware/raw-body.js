const bodyParser = require('body-parser');

const rawBody = bodyParser.raw({
  type: 'application/json',
  verify: (req, res, buf) => {
    // Store the raw buffer directly without any encoding
    req.rawBody = buf;
  }
});

module.exports = rawBody; 