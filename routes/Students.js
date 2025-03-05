const express = require('express');
const router = express.Router();
const Student = require('../models/Student');
const bcrypt = require('bcryptjs');

// Student Signup route
router.post('/signup', async (req, res) => {
  try {
    const { serviceId, name, groupNumber, username, password, token, workspaceName } = req.body;
    
    // Validation checks
    const errors = {};
    
    // Check for required fields
    if (!serviceId) errors.serviceId = 'Service ID is required';
    if (!name) errors.name = 'Name is required';
    if (!groupNumber) errors.groupNumber = 'Group number is required';
    if (!username) errors.username = 'Username is required';
    if (!password) errors.password = 'Password is required';
    if (!token) errors.token = 'Token is required';
    if (!workspaceName) errors.workspaceName = 'Workspace name is required';
    
   
    
    
    // If there are validation errors, return them
    if (Object.keys(errors).length > 0) {
      return res.status(400).json({ errors });
    }
    
    // Check if username already exists
    const existingStudent = await Student.findOne({ username });
    if (existingStudent) {
      return res.status(400).json({ 
        errors: { username: 'Username already exists' }
      });
    }
    
    // Check if service ID already exists
    const existingServiceId = await Student.findOne({ serviceId });
    if (existingServiceId) {
      return res.status(400).json({ 
        errors: { serviceId: 'Service ID already exists' }
      });
    }
    
    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);
    
    // Create new student
    const student = new Student({
      serviceId,
      name,
      groupNumber,
      username,
      password: hashedPassword,
      token,
      workspaceName,
    });
    
    await student.save();
    res.status(201).json({ message: 'Student registered successfully' });
  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ message: 'Server error occurred', error: error.message });
  }
});



router.get("/", async (req, res) => {
  try {
      const students = await Student.find({});
      res.status(200).json({ success: true, data: students });
  } catch (error) {
      console.log('Error in fetching students:', error.message);
      res.status(500).json({ success: false, message: 'Server Error' });
  }
});

// New DELETE route to remove a student
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Find and delete the student
    const deletedStudent = await Student.findByIdAndDelete(id);

    // If no student found
    if (!deletedStudent) {
      return res.status(404).json({ 
        success: false, 
        message: 'Student not found' 
      });
    }

    // Return success response
    res.status(200).json({ 
      success: true, 
      message: 'Student deleted successfully',
      data: deletedStudent 
    });

  } catch (error) {
    console.error('Error deleting student:', error.message);
    res.status(500).json({ 
      success: false, 
      message: 'Server error occurred', 
      error: error.message 
    });
  }
});

module.exports = router;