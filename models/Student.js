const mongoose = require('mongoose');

const studentSchema = new mongoose.Schema({
  serviceId: { type: String, required: true },
  name: { type: String, required: true },
  groupNumber: { type: String, required: true },
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  token: { type: String, required: true },
  workspaceName: { type: String, required: true, unique: true },
});

module.exports = mongoose.model('Student', studentSchema);
