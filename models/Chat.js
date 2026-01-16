const mongoose = require('mongoose');

const ChatSchema = new mongoose.Schema({
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    title: { type: String, default: "New Synthesis" },
    messages: [{
        role: { type: String, enum: ['user', 'assistant'] },
        content: String,
        // Har assistant message ke saath uske sources save honge
        sources: [{
            title: String,
            url: String
        }],
        timestamp: { type: Date, default: Date.now }
    }],
    updatedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Chat', ChatSchema);
