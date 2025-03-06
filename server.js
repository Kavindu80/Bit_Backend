const express = require('express');
const axios = require('axios');
const cors = require('cors');
const dotenv = require('dotenv');
const morgan = require('morgan');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const Student = require('./models/Student');
const Admin = require('./models/Admin');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;
const BITBUCKET_API_URL = 'https://api.bitbucket.org/2.0';

app.use(cors({
  origin: "*", // Allow all origins (for development only)
  methods: ["GET", "POST", "PUT", "DELETE"],
  credentials: true
}));

app.use(express.json());
app.use(morgan('dev'));

class AppError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.statusCode = statusCode;
    // this.isOperational = true
    Error.captureStackTrace(this, this.constructor);
  }
}

const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

app.use((err, req, res, next) => {
  console.error('Error:', {
    message: err.message,
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
    status: err.statusCode || 500,
  });

  const status = err.statusCode || 500;
  const response = {
    success: false,
    error: {
      message: err.message || 'Internal Server Error',
      ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
    },
  };

  res.status(status).json(response);
});

const validateCredentials = async (workspace, accessToken) => {
  try {
    const response = await axios.get(`${BITBUCKET_API_URL}/repositories/${workspace}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      timeout: 5000,
    });
    return response.status === 200;
  } catch (error) {
    const status = error.response?.status || 500;
    const message = error.response?.data?.error?.message || error.message;
    throw new AppError(`Validation failed: ${message}`, status);
  }
};
// Login route to validate username and password and fetch workspace and token
app.post(
  '/api/login',
  asyncHandler(async (req, res, next) => {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required.' });
    }

    const student = await Student.findOne({ username });
    if (!student) {
      return res.status(401).json({ error: 'Invalid username or password.' });
    }

    const isPasswordValid = await bcrypt.compare(password, student.password);
    if (!isPasswordValid) {
      return res.status(401).json({ error: 'Invalid username or password.' });
    }

    // Validate workspace and token
    const isValid = await validateCredentials(student.workspaceName, student.token);
    if (!isValid) {
      return res.status(401).json({ error: 'Workspace or token validation failed.' });
    }

    res.json({
      success: true,
      message: 'Login successful',
      workspace: student.workspaceName,
      token: student.token,
      user: { username: student.username, workspace: student.workspaceName },
    });
  })
);

// Error handling middleware
app.use((err, req, res, next) => {
  res.status(err.status || 500).json({
    error: err.message || 'Something went wrong!',
  });
});

app.get(
  '/api/projects',
  asyncHandler(async (req, res, next) => {
    const { workspace } = req.query;
    const accessToken = req.headers.authorization?.split(' ')[1];

    if (!workspace || !accessToken) {
      return next(new AppError('Workspace and access token are required.', 400));
    }

    try {
      const response = await axios.get(`${BITBUCKET_API_URL}/repositories/${workspace}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      const repositories = response.data.values.map((repo) => ({
        name: repo.name,
        slug: repo.slug,
        description: repo.description,
        updated_on: repo.updated_on,
      }));

      res.json({ success: true, repositories });
    } catch (error) {
      next(new AppError('Failed to fetch repositories. Check your workspace or token.', 500));
    }
  })
);

app.get(
  '/api/commits',
  asyncHandler(async (req, res, next) => {
    const { workspace, repoSlug } = req.query;
    const accessToken = req.headers.authorization?.split(' ')[1];

    if (!workspace || !repoSlug || !accessToken) {
      return next(new AppError('Workspace, repoSlug, and access token are required.', 400));
    }

    try {
      const response = await axios.get(`${BITBUCKET_API_URL}/repositories/${workspace}/${repoSlug}/commits`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      const commits = response.data.values.map((commit) => ({
        hash: commit.hash,
        message: commit.message,
        author: commit.author.raw,
        date: commit.date,
      }));

      res.json({ success: true, commits });
    } catch (error) {
      next(new AppError('Failed to fetch commits. Check your workspace, repoSlug, or token.', 500));
    }
  })
);

mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  retryWrites: false,
  tls: true, 
  authMechanism: "SCRAM-SHA-256" // Ensure authentication is correct
})
  
const adminRoutes = require('./routes/Admins');
app.use('/api/admin', adminRoutes);


const studentRoutes = require('./routes/Students');
app.use('/api/students', studentRoutes);


app.get('/', (req, res) => {
  res.send('Bitbucket Dashboard Backend is running.');
});


app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
