const mongoose = require('mongoose');

const recordSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    name: {
        type: String,
        required: true
    },
    type: {
        type: String,
        required: true
    },
    fileData: {
        type: String,
        required: false
    },
    fileSize: {
        type: Number,
        required: false
    },
    fileName: {
        type: String,
        required: false
    },
    uploadedBy: {
        type: String,
        default: 'System'
    },
    description: String,
    uploadDate: {
        type: Date,
        default: Date.now
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model('Record', recordSchema);
