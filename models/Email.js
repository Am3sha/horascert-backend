const mongoose = require('mongoose');

const emailSchema = new mongoose.Schema({
    senderName: {
        type: String,
        required: true
    },
    senderEmail: {
        type: String,
        required: true
    },
    senderPhone: String,
    subject: {
        type: String,
        required: true
    },
    message: {
        type: String,
        required: true,
        maxlength: 2000
    },
    type: {
        type: String,
        enum: ['contact', 'quote', 'support', 'other'],
        default: 'contact'
    },
    status: {
        type: String,
        enum: ['new', 'read', 'replied', 'archived'],
        default: 'new'
    },
    reply: {
        message: String,
        repliedAt: Date,
        repliedBy: String
    }
}, {
    timestamps: true
});

// Indexes
emailSchema.index({ status: 1 });
emailSchema.index({ senderEmail: 1 });
emailSchema.index({ createdAt: -1 });

// TTL Index: Auto-delete emails after 4 months (120 days)
emailSchema.index(
    { createdAt: 1 },
    { expireAfterSeconds: 60 * 60 * 24 * 120 }
);

// Pre-save hook to set repliedAt when replying and truncate message
emailSchema.pre('save', function (next) {
    // Truncate message to 2000 characters if it exceeds the limit
    if (this.isModified('message') && this.message && this.message.length > 2000) {
        this.message = this.message.substring(0, 2000);
    }

    if (this.isModified('reply.message') && this.reply.message) {
        this.reply.repliedAt = new Date();
        this.status = 'replied';
    }
    next();
});

module.exports = mongoose.model('Email', emailSchema);
