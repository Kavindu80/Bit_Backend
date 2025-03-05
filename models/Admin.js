const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const adminSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
});

// Remove the pre-save middleware since we're handling hashing in the route

module.exports = mongoose.model('Admin', adminSchema);