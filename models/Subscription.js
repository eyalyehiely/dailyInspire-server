const mongoose = require('mongoose');

/**
 * Subscription Schema based on Paddle API documentation
 * @see https://developer.paddle.com/api-reference/subscriptions/overview
 */
const SubscriptionSchema = new mongoose.Schema({
  // Paddle subscription ID
  paddleSubscriptionId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  
  // User reference
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  
  // Paddle customer ID
  paddleCustomerId: {
    type: String,
    required: true,
    index: true
  },
  
  // Subscription status
  status: {
    type: String,
    enum: ['active', 'canceled', 'past_due', 'unpaid', 'trialing', 'paused'],
    default: 'trialing'
  },
  
  // Billing cycle
  billingCycle: {
    interval: {
      type: String,
      enum: ['day', 'week', 'month', 'year'],
      required: true
    },
    frequency: {
      type: Number,
      required: true
    }
  },
  
  // Current billing period
  currentBillingPeriod: {
    startsAt: Date,
    endsAt: Date
  },
  
  // Trial information
  trial: {
    startsAt: Date,
    endsAt: Date
  },
  
  // Payment information
  paymentInformation: {
    cardBrand: String,
    lastFour: String,
    expiryMonth: Number,
    expiryYear: Number
  },
  
  // Subscription items
  items: [{
    priceId: {
      type: String,
      required: true
    },
    quantity: {
      type: Number,
      default: 1
    },
    status: {
      type: String,
      enum: ['active', 'canceled', 'past_due', 'unpaid', 'trialing', 'paused'],
      default: 'active'
    },
    recurring: {
      type: Boolean,
      default: true
    },
    previouslyBilledAt: Date,
    nextBilledAt: Date
  }],
  
  // Management URLs
  managementUrls: {
    updatePaymentMethod: String,
    cancel: String
  },
  
  // Custom data
  customData: {
    type: Map,
    of: mongoose.Schema.Types.Mixed
  },
  
  // Timestamps
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  },
  canceledAt: Date,
  pausedAt: Date,
  firstBilledAt: Date,
  nextBilledAt: Date
}, {
  timestamps: true
});

// Indexes
SubscriptionSchema.index({ status: 1, nextBilledAt: 1 });
SubscriptionSchema.index({ 'items.priceId': 1 });

// Methods
SubscriptionSchema.methods.isActive = function() {
  return ['active', 'trialing'].includes(this.status);
};

SubscriptionSchema.methods.isCanceled = function() {
  return this.status === 'canceled';
};

SubscriptionSchema.methods.isPastDue = function() {
  return this.status === 'past_due';
};

SubscriptionSchema.methods.isUnpaid = function() {
  return this.status === 'unpaid';
};

SubscriptionSchema.methods.isTrialing = function() {
  return this.status === 'trialing';
};

SubscriptionSchema.methods.isPaused = function() {
  return this.status === 'paused';
};

// Static methods
SubscriptionSchema.statics.findByPaddleId = function(paddleId) {
  return this.findOne({ paddleSubscriptionId: paddleId });
};

SubscriptionSchema.statics.findActiveByUserId = function(userId) {
  return this.findOne({
    userId,
    status: { $in: ['active', 'trialing'] }
  });
};

// Pre-save middleware
SubscriptionSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

const Subscription = mongoose.model('Subscription', SubscriptionSchema);

module.exports = Subscription; 