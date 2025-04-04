const bodyParser = require('body-parser');

const rawBody = bodyParser.raw({
  type: 'application/json',
  verify: (req, res, buf) => {
    // Store the raw buffer as a string
    req.rawBody = buf.toString('utf8');
  }
});

module.exports = rawBody; 