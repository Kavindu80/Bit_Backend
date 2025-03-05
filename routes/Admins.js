const express = require('express');
const router = express.Router();
const Admin = require('../models/Admin');
const Student = require('../models/Student');
const bcrypt = require('bcryptjs');
const axios = require('axios');
const NodeCache = require('node-cache');

const BITBUCKET_API_URL = 'https://api.bitbucket.org/2.0';
const bitbucketCache = new NodeCache({ stdTTL: 3600 }); // 1 hour cache

const asyncHandler = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Cached Bitbucket API Fetch with Concurrency Control
async function fetchBitbucketData(url, token, params = {}) {
    const cacheKey = `${url}:${JSON.stringify(params)}`;
    
    const cachedData = bitbucketCache.get(cacheKey);
    if (cachedData) return cachedData;
    
    try {
        const response = await axios.get(url, {
            headers: { 
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/json'
            },
            params: { pagelen: 100, ...params }
        });
        
        bitbucketCache.set(cacheKey, response.data);
        return response.data;
    } catch (error) {
        console.error(`API fetch error for ${url}:`, error.message);
        throw error;
    }
}

// Admin Signup
router.post(
    '/signup',
    asyncHandler(async (req, res) => {
        const { username, password } = req.body;

        if (!username || !password) {
            return res.status(400).json({ message: 'Username and password are required' });
        }

        // Check if admin username already exists
        const existingAdmin = await Admin.findOne({ username });
        if (existingAdmin) {
            return res.status(400).json({ message: 'Admin username already exists' });
        }

        // Hash password and save the admin
        const hashedPassword = await bcrypt.hash(password, 10);
        const admin = new Admin({ username, password: hashedPassword });
        await admin.save();

        res.status(201).json({ message: 'Admin registered successfully' });
    })
);

// Admin Login
router.post(
    '/login',
    asyncHandler(async (req, res) => {
        const { username, password } = req.body;

        if (!username || !password) {
            return res.status(400).json({ message: 'Username and password are required' });
        }

        // Find admin by username
        const admin = await Admin.findOne({ username });
        if (!admin) {
            return res.status(401).json({ message: 'Invalid credentials' });
        }

        // Compare passwords
        const isMatch = await bcrypt.compare(password, admin.password);
        if (!isMatch) {
            return res.status(401).json({ message: 'Invalid credentials' });
        }

        // Send success response
        res.status(200).json({ 
            message: 'Login successful',
            admin: { username: admin.username }
        });
    })
);
// Fetch All Groups with Members
router.get(
    '/groups',
    asyncHandler(async (req, res) => {
        const groups = await Student.aggregate([
            {
                $group: {
                    _id: '$groupNumber',
                    members: { 
                        $push: {
                            name: '$name',
                            workspaceName: '$workspaceName',
                            token: '$token'
                        }
                    },
                    totalMembers: { $sum: 1 }
                }
            },
            { 
                $project: {
                    _id: 0,
                    groupNumber: '$_id',
                    members: 1,
                    totalMembers: 1
                }
            },
            { $sort: { groupNumber: 1 } }
        ]);

        if (!groups.length) {
            return res.status(404).json({ message: 'No groups found' });
        }

        res.setHeader('Cache-Control', 'no-cache');
        res.status(200).json(groups);
    })
);

// Fetch Workspace Projects
router.get(
    '/workspace-projects/:workspaceName',
    asyncHandler(async (req, res) => {
        const { workspaceName } = req.params;
        const student = await Student.findOne({ workspaceName });
        
        if (!student) {
            return res.status(404).json({ message: 'Student workspace not found' });
        }

        try {
            const response = await axios.get(
                `${BITBUCKET_API_URL}/repositories/${workspaceName}`,
                {
                    headers: { 
                        'Authorization': `Bearer ${student.token}`,
                        'Accept': 'application/json'
                    }
                }
            );
            
            const repositories = response.data.values.map(repo => ({
                name: repo.name,
                slug: repo.slug,
                uuid: repo.uuid,
                updated_on: repo.updated_on,
                mainbranch: repo.mainbranch?.name || 'main',
                project: repo.project?.name || 'Default'
            }));

            res.status(200).json(repositories);
        } catch (error) {
            console.error(`Error fetching repositories for ${workspaceName}:`, error.response?.data || error.message);
            res.status(error.response?.status || 500).json({
                message: 'Error fetching workspace projects',
                error: error.response?.data?.error?.message || error.message
            });
        }
    })
);

// Fetch Last Two Commits
router.get(
    '/commits/:workspaceName/:repoSlug',
    asyncHandler(async (req, res) => {
        const { workspaceName, repoSlug } = req.params;
        const student = await Student.findOne({ workspaceName });
        
        if (!student) {
            return res.status(404).json({ message: 'Student workspace not found' });
        }

        try {
            const response = await axios.get(
                `${BITBUCKET_API_URL}/repositories/${workspaceName}/${repoSlug}/commits`,
                {
                    headers: { 
                        'Authorization': `Bearer ${student.token}`,
                        'Accept': 'application/json'
                    },
                    params: { 
                        pagelen: 2,
                        sort: '-date'
                    }
                }
            );

            const commits = response.data.values.map(commit => ({
                hash: commit.hash,
                date: commit.date,
                message: commit.message,
                author: commit.author.raw,
                links: commit.links
            }));

            res.status(200).json(commits);
        } catch (error) {
            console.error(`Error fetching commits for ${workspaceName}/${repoSlug}:`, error.message);
            res.status(500).json({ 
                message: 'Error fetching commits',
                error: error.response?.data?.error?.message || error.message
            });
        }
    })
);

// Fetch All Commits (New Endpoint)
router.get(
    '/all-commits/:workspaceName/:repoSlug',
    asyncHandler(async (req, res) => {
        const { workspaceName, repoSlug } = req.params;
        const student = await Student.findOne({ workspaceName });
        
        if (!student) {
            return res.status(404).json({ message: 'Student workspace not found' });
        }

        try {
            const response = await axios.get(
                `${BITBUCKET_API_URL}/repositories/${workspaceName}/${repoSlug}/commits`,
                {
                    headers: { 
                        'Authorization': `Bearer ${student.token}`,
                        'Accept': 'application/json'
                    },
                    params: { 
                        pagelen: 100,  // Get more commits
                        sort: '-date'
                    }
                }
            );

            const commits = response.data.values.map(commit => ({
                hash: commit.hash,
                date: commit.date,
                message: commit.message,
                author: commit.author.raw,
                links: commit.links
            }));

            res.status(200).json(commits);
        } catch (error) {
            console.error(`Error fetching all commits for ${workspaceName}/${repoSlug}:`, error.message);
            res.status(500).json({ 
                message: 'Error fetching all commits',
                error: error.response?.data?.error?.message || error.message
            });
        }
    })
);

// Fetch Project Contributions
router.get(
    '/contributions/:workspaceName/:repoSlug',
    asyncHandler(async (req, res) => {
        const { workspaceName, repoSlug } = req.params;
        const student = await Student.findOne({ workspaceName });
        
        if (!student) {
            return res.status(404).json({ message: 'Student workspace not found' });
        }

        try {
            const now = new Date();
            const lastWeekDate = new Date(now.getTime() - (7 * 24 * 60 * 60 * 1000));
            const lastMonthDate = new Date(now.getTime() - (30 * 24 * 60 * 60 * 1000));
            const todayStart = new Date(now.setHours(0, 0, 0, 0));

            const response = await axios.get(
                `${BITBUCKET_API_URL}/repositories/${workspaceName}/${repoSlug}/commits`,
                {
                    headers: { 
                        'Authorization': `Bearer ${student.token}`,
                        'Accept': 'application/json'
                    },
                    params: { 
                        pagelen: 100
                    }
                }
            );

            const commits = response.data.values;
            
            const contributionData = {
                totalCommits: commits.length,
                todayCommits: 0,
                lastWeekCommits: 0,
                lastMonthCommits: 0,
                authorStats: {},
                timelineData: []
            };

            commits.forEach(commit => {
                const commitDate = new Date(commit.date);
                const author = commit.author.raw;

                if (!contributionData.authorStats[author]) {
                    contributionData.authorStats[author] = {
                        totalCommits: 0,
                        todayCommits: 0,
                        lastWeekCommits: 0,
                        lastMonthCommits: 0
                    };
                }

                contributionData.authorStats[author].totalCommits++;

                if (commitDate >= todayStart) {
                    contributionData.todayCommits++;
                    contributionData.authorStats[author].todayCommits++;
                }
                if (commitDate >= lastWeekDate) {
                    contributionData.lastWeekCommits++;
                    contributionData.authorStats[author].lastWeekCommits++;
                }
                if (commitDate >= lastMonthDate) {
                    contributionData.lastMonthCommits++;
                    contributionData.authorStats[author].lastMonthCommits++;
                }
            });

            const timelineMap = new Map();
            commits.forEach(commit => {
                const date = new Date(commit.date).toISOString().split('T')[0];
                const author = commit.author.raw;
                
                if (!timelineMap.has(date)) {
                    timelineMap.set(date, {
                        date,
                        total: 0
                    });
                }
                
                const dateEntry = timelineMap.get(date);
                dateEntry.total++;
                dateEntry[author] = (dateEntry[author] || 0) + 1;
            });

            contributionData.timelineData = Array.from(timelineMap.values())
                .sort((a, b) => new Date(a.date) - new Date(b.date));

            Object.keys(contributionData.authorStats).forEach(author => {
                const stats = contributionData.authorStats[author];
                stats.percentage = ((stats.totalCommits / contributionData.totalCommits) * 100).toFixed(1);
            });

            res.status(200).json(contributionData);
        } catch (error) {
            console.error(`Error fetching contributions for ${workspaceName}/${repoSlug}:`, error.message);
            res.status(500).json({ 
                message: 'Error fetching contributions',
                error: error.response?.data?.error?.message || error.message 
            });
        }
    })
);


router.get('/all-contributors', asyncHandler(async (req, res) => {
    try {
        const groups = await Student.aggregate([
            {
                $group: {
                    _id: '$groupNumber',
                    members: {
                        $push: {
                            name: '$name',
                            workspaceName: '$workspaceName',
                            token: '$token'
                        }
                    }
                }
            }
        ]);

        const allContributorsData = [];

        // Process groups sequentially to prevent overwhelming API
        for (const group of groups) {
            for (const member of group.members) {
                try {
                    // Fetch repositories 
                    const reposData = await fetchBitbucketData(
                        `${BITBUCKET_API_URL}/repositories/${member.workspaceName}`, 
                        member.token
                    );

                    // Process each repository
                    for (const repo of reposData.values) {
                        try {
                            const commitsData = await fetchBitbucketData(
                                `${BITBUCKET_API_URL}/repositories/${member.workspaceName}/${repo.slug}/commits`, 
                                member.token
                            );

                            // Group commits by author
                            const commitsByAuthor = {};
                            commitsData.values.forEach(commit => {
                                const author = commit.author.raw;
                                if (!commitsByAuthor[author]) {
                                    commitsByAuthor[author] = [];
                                }
                                if (commitsByAuthor[author].length < 3) {
                                    commitsByAuthor[author].push({
                                        hash: commit.hash,
                                        message: commit.message,
                                        date: commit.date,
                                        projectName: repo.name,
                                        projectSlug: repo.slug,
                                        workspaceName: member.workspaceName
                                    });
                                }
                            });

                            // Merge contributors data
                            Object.entries(commitsByAuthor).forEach(([author, commits]) => {
                                const existingAuthor = allContributorsData.find(c => c.author === author);
                                if (existingAuthor) {
                                    existingAuthor.commits.push(...commits);
                                    existingAuthor.commits.sort((a, b) => new Date(b.date) - new Date(a.date));
                                    existingAuthor.commits = existingAuthor.commits.slice(0, 3);
                                } else {
                                    allContributorsData.push({
                                        author,
                                        commits: commits.slice(0, 3)
                                    });
                                }
                            });
                        } catch (commitError) {
                            console.error(`Commits fetch error for ${member.workspaceName}/${repo.slug}:`, commitError.message);
                        }
                    }
                } catch (repoError) {
                    console.error(`Repositories fetch error for ${member.workspaceName}:`, repoError.message);
                }
            }
        }

        res.status(200).json(allContributorsData);
    } catch (error) {
        console.error('Contributors fetch error:', error);
        res.status(500).json({
            message: 'Error fetching contributors data',
            error: error.response?.data?.error?.message || error.message
        });
    }
}));


// Keep the existing error handler
router.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ 
        message: 'Server error',
        error: err.message 
    });
});

module.exports = router;