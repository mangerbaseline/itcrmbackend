// ==========================================
// IT COMPANY CRM - Complete Backend
// ==========================================

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
require('dotenv').config();
const cron = require('node-cron');

const app = express();
const PORT = process.env.PORT || 5001;
const JWT_SECRET = process.env.JWT_SECRET || 'it-crm-secret-key';
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/it-crm';

app.use(cors({
  origin: ['https://itcrmfrontend.vercel.app', 'http://localhost:3005'],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json({ limit: '10mb' }));

// ==========================================
// MONGODB CONNECTION
// ==========================================
mongoose.connect(MONGODB_URI)
  .then(() => console.log('✓ MongoDB connected'))
  .catch(err => console.error('MongoDB error:', err.message));

// ==========================================
// SCHEMAS
// ==========================================
const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  role: { type: String, enum: ['owner', 'hr', 'sales', 'bdm', 'pm', 'dev'], required: true },
  assignedPM: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // for developers assigned to a PM
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  isActive: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now }
});

const noteSchema = new mongoose.Schema({
  text: String,
  addedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  addedByRole: String,
  addedByName: String,
  stage: String, // 'bdm-approval', 'pm-approval', 'sales-approval', 'general'
  createdAt: { type: Date, default: Date.now }
});

const projectSchema = new mongoose.Schema({
  title: { type: String, required: true },
  description: String,
  source: { type: String, enum: ['upwork', 'fiverr', 'freelancer', 'referral', 'direct', 'other'], default: 'other' },
  sourceDetail: String,
  budget: String,
  deadline: Date,
  salesManager: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  bdm: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  pm: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  developers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  allocatedHours: { type: Number, default: 0 },
  extraHoursAdded: { type: Number, default: 0 },
  totalApprovedHours: { type: Number, default: 0 },
  usedHours: { type: Number, default: 0 }, // Track hours used by developers
  remainingHours: { type: Number, default: 0 },
  status: {
    type: String,
    enum: ['pending', 'bdm-approved', 'pm-approved', 'sales-approved', 'completed', 'cancelled'],
    default: 'pending'
  },
  bdmApprovedAt: Date,
  pmApprovedAt: Date,
  salesApprovedAt: Date,
  notes: [noteSchema],
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  createdAt: { type: Date, default: Date.now }
});

const timesheetSchema = new mongoose.Schema({
  developer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  project: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true },
  date: { type: Date, required: true },
  onlineHours: { type: Number, default: 0 },
  offlineHours: { type: Number, default: 0 },
  totalHours: { type: Number, default: 0 },
  description: String,
  aiVerified: { type: Boolean, default: false },
  aiScore: { type: Number, default: 0 },
  aiFeedback: String,
  status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
  approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  // ── Analysis tracking ──
  analysisStatus: { type: String, enum: ['pending', 'analyzed'], default: 'pending' },
  analysisResult: {
    health: String,
    aiScore: Number,
    aiFeedback: String,
    analyzedAt: Date,
    analyzedBy: String
  },
  createdAt: { type: Date, default: Date.now }
});

const leaveSchema = new mongoose.Schema({
  applicant: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  date: { type: Date, required: true },
  reason: String,
  status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
  approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  approvedByName: String,
  approvedByRole: String,
  createdAt: { type: Date, default: Date.now }
});

const noticeSchema = new mongoose.Schema({
  title: { type: String, required: true },
  message: { type: String, required: true },
  type: { type: String, enum: ['notification', 'warning', 'greeting', 'announcement', 'urgent', 'info'], default: 'notification' },
  color: { type: String, default: '#0ea5e9' },
  sentBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  sentByName: { type: String, required: true },
  sentByRole: { type: String, required: true },
  targetType: { type: String, enum: ['all', 'individual'], default: 'all' },
  targetUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  createdAt: { type: Date, default: Date.now }
});

const suggestionSchema = new mongoose.Schema({
  message: { type: String, required: true },
  senderId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);
const Project = mongoose.model('Project', projectSchema);
const Timesheet = mongoose.model('Timesheet', timesheetSchema);
const Leave = mongoose.model('Leave', leaveSchema);
const Notice = mongoose.model('Notice', noticeSchema);
const Suggestion = mongoose.model('Suggestion', suggestionSchema);

// ==========================================
// GROQ AI INTEGRATION
// ==========================================
const GROQ_API_KEY = process.env.GROQ_API_KEY || '';

async function callGroqAI(systemPrompt, userPrompt) {
  if (!GROQ_API_KEY) return null;
  try {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + GROQ_API_KEY
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.3,
        max_tokens: 1000
      })
    });
    const d = await res.json();
    return d?.choices?.[0]?.message?.content || null;
  } catch (e) {
    console.error('Groq API error:', e.message);
    return null;
  }
}

// ==========================================
// AI TIMESHEET VERIFICATION
// ==========================================
async function verifyTimesheetWithAI(developer, project, description, onlineHours, offlineHours) {
  const notesText = (project.notes || []).map(n =>
    `[${n.addedByRole || 'Unknown'}]: ${n.text}`
  ).join('\n');

  const projectContext = `Project: ${project.title}
Description: ${project.description || 'N/A'}
Notes from team (SM/BDM/PM): ${notesText || 'None yet'}
Developer work description: ${description || 'N/A'}`;

  const total = onlineHours + offlineHours;
  if (total <= 0) return { verified: false, score: 0, feedback: 'No hours logged', projectContext };
  if (total > 16) return { verified: false, score: 20, feedback: 'Hours exceed reasonable daily limit (16h)', projectContext };
  if (!description || description.length < 10) return { verified: false, score: 30, feedback: 'Description too short, please add more detail', projectContext };

  // Try Groq AI first
  if (GROQ_API_KEY) {
    const systemPrompt = 'You are an AI project manager assistant. Analyze developer work status against project notes and requirements. Respond in exactly this JSON format: {"score": 0-100, "health": "Good"|"Fair"|"Needs Attention", "feedback": "brief analysis", "alignment": "brief explanation"}';
    const userPrompt = `Project: ${project.title}
Description: ${project.description || 'N/A'}
Team Notes:
${notesText || 'None'}

Developer: ${developer?.name || 'Unknown'}
Hours logged: ${onlineHours}h online / ${offlineHours}h offline
Developer status: "${description}"`;

    const groqResult = await callGroqAI(systemPrompt, userPrompt);
    if (groqResult) {
      try {
        const parsed = JSON.parse(groqResult);
        const score = Math.min(100, Math.max(0, parsed.score || 50));
        const health = parsed.health || 'Fair';
        return {
          verified: score >= 55,
          score,
          feedback: parsed.feedback || 'Analysis complete.',
          projectContext,
          smoothScore: health === 'Good' ? 80 : health === 'Fair' ? 50 : 30,
          groqAnalysis: parsed.alignment || '',
          health
        };
      } catch (e) {
        // Fall through to keyword-based if JSON parse fails
      }
    }
  }

  // Fallback: keyword-based analysis
  const allProjectWords = (project.title + ' ' + (project.description || '') + ' ' + (notesText || '')).toLowerCase().split(/\s+/);
  const descWords = description.toLowerCase().split(/\s+/);
  const stopWords = ['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'been', 'be', 'has', 'have', 'had', 'do', 'does', 'did', 'will', 'would', 'can', 'could', 'may', 'might', 'shall', 'should', 'this', 'that', 'these', 'those', 'i', 'me', 'my', 'we', 'our', 'you', 'your', 'he', 'she', 'it', 'they', 'them', 'their'];
  const filteredDesc = descWords.filter(w => w.length > 2 && !stopWords.includes(w));
  const relevantWords = filteredDesc.filter(w => allProjectWords.includes(w));

  const relevanceScore = filteredDesc.length > 0
    ? Math.min(100, Math.round((relevantWords.length / filteredDesc.length) * 80 + 20))
    : 30;

  const hasConcerns = notesText.toLowerCase().includes('concern') ||
    notesText.toLowerCase().includes('issue') ||
    notesText.toLowerCase().includes('delay') ||
    notesText.toLowerCase().includes('problem') ||
    notesText.toLowerCase().includes('warning');

  const score = hasConcerns ? Math.min(70, relevanceScore) : Math.min(100, relevanceScore);
  const verified = score >= 55;

  let feedback;
  if (hasConcerns && !verified) {
    feedback = 'AI warning: Project notes mention concerns. Developer work may need review against team notes.';
  } else if (verified) {
    feedback = 'AI verified: aligned with project and team notes.';
  } else {
    feedback = 'AI flagged: relevance low. Provide more specific details matching project scope.';
  }

  const smoothScore = hasConcerns ? Math.min(60, score) : score;
  feedback += ' | Health: ' + (smoothScore >= 70 ? 'Good' : smoothScore >= 50 ? 'Fair' : 'Needs Attention');

  return { verified, score, feedback, projectContext, smoothScore, health: smoothScore >= 70 ? 'Good' : smoothScore >= 50 ? 'Fair' : 'Needs Attention' };
}

// ==========================================
// SINGLE TIMESHEET ANALYSIS HELPER
// ==========================================
async function runSingleTimesheetAnalysis(timesheetId, analyzedBy) {
  const ts = await Timesheet.findById(timesheetId)
    .populate('developer', 'name email')
    .populate('project', 'title description notes');
  if (!ts) return null;

  const analysis = await verifyTimesheetWithAI(
    ts.developer,
    ts.project,
    ts.description || '',
    ts.onlineHours,
    ts.offlineHours
  );

  const health = analysis.health ||
    (analysis.smoothScore >= 70 ? 'Good' : analysis.smoothScore >= 50 ? 'Fair' : 'Needs Attention');

  ts.analysisStatus = 'analyzed';
  ts.analysisResult = {
    health,
    aiScore: analysis.score,
    aiFeedback: analysis.feedback,
    analyzedAt: new Date(),
    analyzedBy: analyzedBy || 'owner'
  };
  await ts.save();

  return { timesheet: ts, analysis };
}

// ==========================================
// MIDDLEWARE
// ==========================================
async function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return res.status(401).json({ success: false, message: 'No token' });
  try {
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await User.findById(decoded.userId);
    if (!user || !user.isActive) return res.status(401).json({ success: false, message: 'User not found or inactive' });
    req.user = user;
    next();
  } catch (e) {
    return res.status(401).json({ success: false, message: 'Invalid token' });
  }
}

function roleMiddleware(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) return res.status(403).json({ success: false, message: 'Access denied' });
    next();
  };
}

// ==========================================
// AUTH ROUTES
// ==========================================
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user || !(await bcrypt.compare(password, user.password))) return res.json({ success: false, message: 'Invalid credentials' });
    const token = jwt.sign({ userId: user._id, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
    res.json({
      success: true, token,
      user: { id: user._id, name: user.name, email: user.email, role: user.role, assignedPM: user.assignedPM }
    });
  } catch (e) { res.json({ success: false, message: 'Server error' }); }
});

app.get('/api/auth/me', authMiddleware, (req, res) => {
  res.json({
    success: true,
    user: { id: req.user._id, name: req.user.name, email: req.user.email, role: req.user.role, assignedPM: req.user.assignedPM }
  });
});

// ==========================================
// USER MANAGEMENT (Owner & HR only)
// ==========================================
app.get('/api/users', authMiddleware, async (req, res) => {
  try {
    // Filter by role if specified
    const filter = {};
    if (req.query.role) filter.role = req.query.role;

    // PM can see their developers, devs can see themselves
    if (req.user.role === 'pm') {
      filter.$or = [{ role: 'dev', assignedPM: req.user._id }, { _id: req.user._id }];
    } else if (req.user.role === 'dev') {
      filter._id = req.user._id;
    }

    const users = await User.find(filter).select('-password').sort({ role: 1, name: 1 });
    res.json({ success: true, users });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

app.post('/api/users', authMiddleware, roleMiddleware('owner', 'hr'), async (req, res) => {
  try {
    const { name, email, password, role } = req.body;
    if (!name || !email || !password || !role) return res.json({ success: false, message: 'All fields required' });
    if (await User.findOne({ email })) return res.json({ success: false, message: 'Email already exists' });

    // Only owner can create other owners
    if (role === 'owner' && req.user.role !== 'owner') return res.status(403).json({ success: false, message: 'Only owner can create owners' });

    const hashed = await bcrypt.hash(password, 10);
    const user = await User.create({ name, email, password: hashed, role, createdBy: req.user._id });
    res.json({ success: true, user: { id: user._id, name, email, role } });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

app.put('/api/users/:id', authMiddleware, roleMiddleware('owner', 'hr'), async (req, res) => {
  try {
    const { name, email, role, isActive, assignedPM } = req.body;
    const update = {};
    if (name) update.name = name;
    if (email) update.email = email;
    if (role && req.user.role === 'owner') update.role = role;
    if (isActive !== undefined) update.isActive = isActive;
    if (assignedPM !== undefined) update.assignedPM = assignedPM;

    const user = await User.findByIdAndUpdate(req.params.id, update, { new: true }).select('-password');
    if (!user) return res.json({ success: false, message: 'User not found' });
    res.json({ success: true, user });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

app.delete('/api/users/:id', authMiddleware, roleMiddleware('owner'), async (req, res) => {
  try {
    await User.findByIdAndUpdate(req.params.id, { isActive: false });
    res.json({ success: true, message: 'User deactivated' });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

// ==========================================
// ASSIGN DEVELOPERS TO PM (HR)
// ==========================================
app.post('/api/users/assign-pm', authMiddleware, roleMiddleware('owner', 'hr'), async (req, res) => {
  try {
    const { developerId, pmId } = req.body;
    const developer = await User.findById(developerId);
    if (!developer || developer.role !== 'dev') return res.json({ success: false, message: 'Invalid developer' });
    const pm = await User.findById(pmId);
    if (!pm || pm.role !== 'pm') return res.json({ success: false, message: 'Invalid PM' });

    developer.assignedPM = pmId;
    await developer.save();
    res.json({ success: true, message: 'Developer assigned to PM' });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

// ==========================================
// PROJECT MANAGEMENT
// ==========================================

// Create project (Sales Manager)
app.post('/api/projects', authMiddleware, roleMiddleware('owner', 'sales'), async (req, res) => {
  try {
    const { title, description, source, sourceDetail, budget, deadline, bdm, pm, developers, allocatedHours } = req.body;
    if (!title) return res.json({ success: false, message: 'Project title required' });

    const project = await Project.create({
      title, description, source: source || 'other', sourceDetail, budget, deadline,
      bdm, pm, developers: developers || [], allocatedHours: allocatedHours || 0,
      salesManager: req.user._id,
      createdBy: req.user._id,
      status: 'pending'
    });

    const populated = await Project.findById(project._id)
      .populate('salesManager', 'name email')
      .populate('bdm', 'name email')
      .populate('pm', 'name email')
      .populate('developers', 'name email');
    res.json({ success: true, project: populated });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

// Get projects (filtered by role)
app.get('/api/projects', authMiddleware, async (req, res) => {
  try {
    let filter = {};
    const role = req.user.role;

    if (role === 'owner') {
      // Owner sees all
    } else if (role === 'sales') {
      filter.salesManager = req.user._id;
    } else if (role === 'bdm') {
      filter.bdm = req.user._id;
    } else if (role === 'pm') {
      filter.pm = req.user._id;
    } else if (role === 'dev') {
      filter.developers = req.user._id;
    } else if (role === 'hr') {
      // HR sees all active projects
      filter.status = { $ne: 'cancelled' };
    }

    if (req.query.status) filter.status = req.query.status;

    const projects = await Project.find(filter)
      .populate('salesManager', 'name email')
      .populate('bdm', 'name email')
      .populate('pm', 'name email')
      .populate('developers', 'name email')
      .populate('notes.addedBy', 'name role')
      .sort({ createdAt: -1 });

    res.json({ success: true, projects });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

// Get single project
app.get('/api/projects/:id', authMiddleware, async (req, res) => {
  try {
    const project = await Project.findById(req.params.id)
      .populate('salesManager', 'name email')
      .populate('bdm', 'name email')
      .populate('pm', 'name email')
      .populate('developers', 'name email')
      .populate('notes.addedBy', 'name role');

    if (!project) return res.json({ success: false, message: 'Project not found' });

    // Role-based access check
    const role = req.user.role;
    if (role === 'dev' && !project.developers.some(d => d._id.toString() === req.user._id.toString()) && project.pm?.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    res.json({ success: true, project });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

// Update project
app.put('/api/projects/:id', authMiddleware, async (req, res) => {
  try {
    const project = await Project.findById(req.params.id);
    if (!project) return res.json({ success: false, message: 'Project not found' });

    const { title, description, source, sourceDetail, budget, deadline, bdm, pm, developers, allocatedHours } = req.body;
    if (title) project.title = title;
    if (description !== undefined) project.description = description;
    if (source) project.source = source;
    if (sourceDetail !== undefined) project.sourceDetail = sourceDetail;
    if (budget !== undefined) project.budget = budget;
    if (deadline) project.deadline = deadline;
    if (bdm !== undefined) project.bdm = bdm;
    if (pm !== undefined) project.pm = pm;
    if (developers) project.developers = developers;
    if (allocatedHours !== undefined) project.allocatedHours = allocatedHours;

    await project.save();
    const populated = await Project.findById(project._id)
      .populate('salesManager', 'name email')
      .populate('bdm', 'name email')
      .populate('pm', 'name email')
      .populate('developers', 'name email');
    res.json({ success: true, project: populated });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

// ==========================================
// PROJECT APPROVAL FLOW
// ==========================================

// Add note to project
app.post('/api/projects/:id/notes', authMiddleware, async (req, res) => {
  try {
    const project = await Project.findById(req.params.id);
    if (!project) return res.json({ success: false, message: 'Project not found' });

    project.notes.push({
      text: req.body.text,
      addedBy: req.user._id,
      addedByRole: req.user.role,
      addedByName: req.user.name,
      stage: req.body.stage || 'general'
    });
    await project.save();
    res.json({ success: true, notes: project.notes });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

// BDM Approve
app.post('/api/projects/:id/bdm-approve', authMiddleware, roleMiddleware('owner', 'bdm'), async (req, res) => {
  try {
    const project = await Project.findById(req.params.id);
    if (!project) return res.json({ success: false, message: 'Project not found' });
    if (project.bdm?.toString() !== req.user._id.toString() && req.user.role !== 'owner') {
      return res.status(403).json({ success: false, message: 'Not your project to approve' });
    }

    project.status = 'bdm-approved';
    project.bdmApprovedAt = new Date();
    if (req.body.note) {
      project.notes.push({ text: req.body.note, addedBy: req.user._id, addedByRole: req.user.role, addedByName: req.user.name, stage: 'bdm-approval' });
    }
    await project.save();
    res.json({ success: true, project, message: 'Project approved by BDM' });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

// PM Approve
app.post('/api/projects/:id/pm-approve', authMiddleware, roleMiddleware('owner', 'pm'), async (req, res) => {
  try {
    const project = await Project.findById(req.params.id);
    if (!project) return res.json({ success: false, message: 'Project not found' });
    if (project.pm?.toString() !== req.user._id.toString() && req.user.role !== 'owner') {
      return res.status(403).json({ success: false, message: 'Not your project to approve' });
    }

    project.status = 'pm-approved';
    project.pmApprovedAt = new Date();
    if (req.body.note) {
      project.notes.push({ text: req.body.note, addedBy: req.user._id, addedByRole: req.user.role, addedByName: req.user.name, stage: 'pm-approval' });
    }
    await project.save();
    res.json({ success: true, project, message: 'Project approved by PM' });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

// Sales Manager Approve (final approval)
app.post('/api/projects/:id/sales-approve', authMiddleware, roleMiddleware('owner', 'sales'), async (req, res) => {
  try {
    const project = await Project.findById(req.params.id);
    if (!project) return res.json({ success: false, message: 'Project not found' });

    project.status = 'sales-approved';
    project.salesApprovedAt = new Date();
    if (req.body.note) {
      project.notes.push({ text: req.body.note, addedBy: req.user._id, addedByRole: req.user.role, addedByName: req.user.name, stage: 'sales-approval' });
    }
    await project.save();
    res.json({ success: true, project, message: 'Project fully approved' });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

// Add extra hours (Sales Manager)
app.post('/api/projects/:id/add-hours', authMiddleware, roleMiddleware('owner', 'sales'), async (req, res) => {
  try {
    const { hours } = req.body;
    if (!hours || hours <= 0) return res.json({ success: false, message: 'Valid hours required' });

    const project = await Project.findById(req.params.id);
    if (!project) return res.json({ success: false, message: 'Project not found' });

    project.extraHoursAdded = (project.extraHoursAdded || 0) + Number(hours);
    project.totalApprovedHours = (project.allocatedHours || 0) + project.extraHoursAdded;
    await project.save();
    res.json({ success: true, project, message: `${hours} extra hours added` });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

// Complete project
app.post('/api/projects/:id/complete', authMiddleware, roleMiddleware('owner', 'sales'), async (req, res) => {
  try {
    const project = await Project.findByIdAndUpdate(req.params.id, { status: 'completed' }, { new: true });
    res.json({ success: true, project });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

// ==========================================
// TIMESHEET MANAGEMENT
// ==========================================

// Submit timesheet (Developer)
app.post('/api/timesheets', authMiddleware, roleMiddleware('owner', 'dev'), async (req, res) => {
  try {
    const { projectId, date, onlineHours, offlineHours, description } = req.body;
    if (!projectId || !date) return res.json({ success: false, message: 'Project and date required' });

    const project = await Project.findById(projectId);
    if (!project) return res.json({ success: false, message: 'Project not found' });
    if (req.user.role === 'dev' && !project.developers.some(d => d.toString() === req.user._id.toString())) {
      return res.status(403).json({ success: false, message: 'Not assigned to this project' });
    }

    // Check if developer already submitted for today
    const todayStart = new Date(new Date().setHours(0, 0, 0, 0));
    const todayEnd = new Date(new Date().setHours(23, 59, 59, 999));
    const existing = await Timesheet.findOne({
      developer: req.user._id,
      project: projectId,
      date: { $gte: todayStart, $lte: todayEnd }
    });
    if (existing) {
      return res.json({ success: false, message: 'You already submitted hours for this project today. Only one submission per day is allowed.' });
    }

    const total = Number(onlineHours || 0) + Number(offlineHours || 0);

    // AI verification
    const aiResult = await verifyTimesheetWithAI(req.user, project, description || '', Number(onlineHours || 0), Number(offlineHours || 0));

    const timesheet = await Timesheet.create({
      developer: req.user._id,
      project: projectId,
      date: new Date(date),
      onlineHours: Number(onlineHours || 0),
      offlineHours: Number(offlineHours || 0),
      totalHours: total,
      description: description || '',
      aiVerified: aiResult.verified,
      aiScore: aiResult.score,
      aiFeedback: aiResult.feedback,
      status: 'pending'
    });

    // Update project used/remaining hours
    project.usedHours = (project.usedHours || 0) + total;
    project.remainingHours = Math.max(0, (project.totalApprovedHours || project.allocatedHours || 0) - project.usedHours);
    await project.save();

    const populated = await Timesheet.findById(timesheet._id)
      .populate('developer', 'name email')
      .populate('project', 'title');

    res.json({ success: true, timesheet: populated });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

// Get timesheets (filtered by role)
app.get('/api/timesheets', authMiddleware, async (req, res) => {
  try {
    let filter = {};
    const role = req.user.role;

    if (role === 'dev') {
      filter.developer = req.user._id;
    } else if (role === 'pm') {
      // PM sees timesheets of their developers
      const myDevs = await User.find({ role: 'dev', assignedPM: req.user._id }).select('_id');
      filter.developer = { $in: myDevs.map(d => d._id) };
    }

    if (req.query.projectId) filter.project = req.query.projectId;
    if (req.query.developerId) filter.developer = req.query.developerId;
    if (req.query.status) filter.status = req.query.status;

    // Date range filter
    if (req.query.startDate || req.query.endDate) {
      filter.date = {};
      if (req.query.startDate) filter.date.$gte = new Date(req.query.startDate);
      if (req.query.endDate) filter.date.$lte = new Date(req.query.endDate);
    }

    const timesheets = await Timesheet.find(filter)
      .populate('developer', 'name email')
      .populate('project', 'title')
      .sort({ date: -1, createdAt: -1 });

    res.json({ success: true, timesheets });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

// Approve/Reject timesheet (PM/Owner)
app.put('/api/timesheets/:id/approve', authMiddleware, roleMiddleware('owner', 'pm'), async (req, res) => {
  try {
    const timesheet = await Timesheet.findById(req.params.id).populate('project');
    if (!timesheet) return res.json({ success: false, message: 'Timesheet not found' });

    timesheet.status = req.body.status || 'approved';
    timesheet.approvedBy = req.user._id;
    await timesheet.save();

    res.json({ success: true, timesheet });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

// GET today's timesheets with analysis status (Owner only)
app.get('/api/timesheets/today-status', authMiddleware, roleMiddleware('owner'), async (req, res) => {
  try {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    const timesheets = await Timesheet.find({
      date: { $gte: todayStart, $lte: todayEnd }
    })
      .populate('developer', 'name email')
      .populate('project', 'title')
      .sort({ developer: 1, createdAt: -1 });

    res.json({ success: true, timesheets });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

// POST analyze a single timesheet and persist result (Owner only)
app.post('/api/timesheets/:id/analyze', authMiddleware, roleMiddleware('owner'), async (req, res) => {
  try {
    const result = await runSingleTimesheetAnalysis(req.params.id, 'owner');
    if (!result) return res.json({ success: false, message: 'Timesheet not found' });
    res.json({ success: true, timesheet: result.timesheet, analysis: result.analysis });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

// ==========================================
// LEAVE MANAGEMENT
// ==========================================

// Submit leave request (Dev, PM, BDM, Sales, HR, Owner)
app.post('/api/leaves', authMiddleware, async (req, res) => {
  try {
    const { date, reason } = req.body;
    if (!date) return res.json({ success: false, message: 'Date is required' });
    const leave = await Leave.create({
      applicant: req.user._id,
      date: new Date(date),
      reason: reason || '',
      status: 'pending'
    });
    res.json({ success: true, leave });
  } catch (e) {
    res.json({ success: false, message: e.message });
  }
});

// Get leaves based on role
app.get('/api/leaves', authMiddleware, async (req, res) => {
  try {
    const role = req.user.role;
    let leaves;
    // Owner, HR, PM, BDM, Sales can view all leaves to review/approve/manage them
    if (['owner', 'hr', 'pm', 'bdm', 'sales'].includes(role)) {
      leaves = await Leave.find()
        .populate('applicant', 'name email role')
        .sort({ date: -1 });
    } else {
      // Devs only see their own leaves
      leaves = await Leave.find({ applicant: req.user._id })
        .populate('applicant', 'name email role')
        .sort({ date: -1 });
    }
    res.json({ success: true, leaves });
  } catch (e) {
    res.json({ success: false, message: e.message });
  }
});

// Approve or reject a leave request
app.put('/api/leaves/:id/approve', authMiddleware, roleMiddleware('owner', 'hr', 'pm', 'bdm', 'sales'), async (req, res) => {
  try {
    const { status } = req.body;
    if (!['approved', 'rejected'].includes(status)) {
      return res.json({ success: false, message: 'Invalid status' });
    }
    const leave = await Leave.findById(req.params.id);
    if (!leave) return res.json({ success: false, message: 'Leave request not found' });

    leave.status = status;
    leave.approvedBy = req.user._id;
    leave.approvedByName = req.user.name;
    leave.approvedByRole = req.user.role;
    await leave.save();

    res.json({ success: true, leave });
  } catch (e) {
    res.json({ success: false, message: e.message });
  }
});

// ==========================================
// REPORTS
// ==========================================

// Hours report by project
app.get('/api/reports/project-hours', authMiddleware, async (req, res) => {
  try {
    const match = {};
    if (req.query.projectId) match.project = new mongoose.Types.ObjectId(req.query.projectId);
    if (req.query.startDate || req.query.endDate) {
      match.date = {};
      if (req.query.startDate) match.date.$gte = new Date(req.query.startDate);
      if (req.query.endDate) match.date.$lte = new Date(req.query.endDate);
    }

    const report = await Timesheet.aggregate([
      { $match: match },
      {
        $group: {
          _id: { project: '$project', developer: '$developer' },
          totalOnline: { $sum: '$onlineHours' },
          totalOffline: { $sum: '$offlineHours' },
          totalHours: { $sum: '$totalHours' },
          count: { $sum: 1 }
        }
      },
      { $lookup: { from: 'projects', localField: '_id.project', foreignField: '_id', as: 'project' } },
      { $lookup: { from: 'users', localField: '_id.developer', foreignField: '_id', as: 'developer' } },
      { $unwind: '$project' },
      { $unwind: '$developer' },
      { $sort: { totalHours: -1 } }
    ]);
    res.json({ success: true, report });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

// Monthly summary - for devs returns own hours, for PM/BDM/Sales returns dev hours on their projects
app.get('/api/reports/my-hours', authMiddleware, async (req, res) => {
  try {
    const userId = req.query.userId || req.user._id;
    const role = req.user.role;

    // Parse query params for month/year filtering
    let dateFilter = {};
    const queryYear = req.query.year;
    const queryMonth = req.query.month;

    if ((queryYear && queryYear !== 'all') || (queryMonth && queryMonth !== 'all')) {
      const year = queryYear && queryYear !== 'all' ? parseInt(queryYear) : new Date().getFullYear();
      if (queryMonth && queryMonth !== 'all') {
        const month = parseInt(queryMonth) - 1; // 0-indexed
        const start = new Date(year, month, 1);
        const end = new Date(year, month + 1, 0, 23, 59, 59, 999);
        dateFilter = { $gte: start, $lte: end };
      } else {
        const start = new Date(year, 0, 1);
        const end = new Date(year, 12, 0, 23, 59, 59, 999);
        dateFilter = { $gte: start, $lte: end };
      }
    } else if (queryYear === 'all' && queryMonth === 'all') {
      dateFilter = null;
    } else {
      const now = new Date();
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
      dateFilter = { $gte: start, $lte: end };
    }

    // For devs: get their own timesheets
    if (role === 'dev') {
      const query = { developer: userId };
      if (dateFilter) query.date = dateFilter;

      const timesheets = await Timesheet.find(query).populate('project', 'title pm bdm salesManager developers').sort({ date: -1 });

      const total = timesheets.reduce((sum, t) => sum + t.totalHours, 0);
      const online = timesheets.reduce((sum, t) => sum + t.onlineHours, 0);
      const offline = timesheets.reduce((sum, t) => sum + t.offlineHours, 0);

      const byProject = {};
      timesheets.forEach(t => {
        const pid = t.project?._id || 'unknown';
        if (!byProject[pid]) byProject[pid] = { project: t.project, hours: 0, online: 0, offline: 0, count: 0 };
        byProject[pid].hours += t.totalHours;
        byProject[pid].online += t.onlineHours;
        byProject[pid].offline += t.offlineHours;
        byProject[pid].count += 1;
      });

      return res.json({
        success: true,
        summary: { total, online, offline, days: timesheets.length },
        byProject: Object.values(byProject),
        timesheets
      });
    }

    // For PM/BDM/Sales/Owner/HR: get aggregated hours from developers on THEIR projects
    let projectFilter = {};
    if (role === 'pm') projectFilter.pm = userId;
    else if (role === 'bdm') projectFilter.bdm = userId;
    else if (role === 'sales') projectFilter.salesManager = userId;
    // owner & hr: no filter, all projects

    const myProjects = await Project.find(projectFilter).select('_id title');
    const projectIds = myProjects.map(p => p._id);

    if (projectIds.length === 0) {
      return res.json({
        success: true,
        summary: { total: 0, online: 0, offline: 0, days: 0 },
        byProject: [],
        timesheets: [],
        projectHours: {}
      });
    }

    const query = { project: { $in: projectIds } };
    if (dateFilter) query.date = dateFilter;

    // Get all timesheets for these projects this month, grouped by project
    const timesheets = await Timesheet.find(query).populate('developer', 'name email').populate('project', 'title').sort({ date: -1 });

    const total = timesheets.reduce((sum, t) => sum + t.totalHours, 0);
    const online = timesheets.reduce((sum, t) => sum + t.onlineHours, 0);
    const offline = timesheets.reduce((sum, t) => sum + t.offlineHours, 0);

    // Group by project
    const byProject = {};
    const projectHours = {};
    timesheets.forEach(t => {
      const pid = t.project?._id || 'unknown';
      if (!byProject[pid]) byProject[pid] = { project: t.project, hours: 0, online: 0, offline: 0, count: 0 };
      byProject[pid].hours += t.totalHours;
      byProject[pid].online += t.onlineHours;
      byProject[pid].offline += t.offlineHours;
      byProject[pid].count += 1;
    });

    // Also track per-project totals (including all months for cumulative)
    const allTimesheets = await Timesheet.find({
      project: { $in: projectIds }
    });
    allTimesheets.forEach(t => {
      const pid = t.project?.toString() || 'unknown';
      if (!projectHours[pid]) projectHours[pid] = { total: 0, count: 0 };
      projectHours[pid].total += t.totalHours;
      projectHours[pid].count += 1;
    });

    res.json({
      success: true,
      summary: { total, online, offline, days: timesheets.length, projectsCount: projectIds.length },
      byProject: Object.values(byProject),
      timesheets: timesheets.slice(0, 50),
      projectHours
    });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

// AI Analysis: Compare dev timesheets against project notes (Owner only)
app.post('/api/reports/analyze-day', authMiddleware, roleMiddleware('owner'), async (req, res) => {
  try {
    const { date } = req.body;
    const analyzeDate = date ? new Date(date) : new Date();
    const dayStart = new Date(analyzeDate.setHours(0, 0, 0, 0));
    const dayEnd = new Date(analyzeDate.setHours(23, 59, 59, 999));

    // Build filter
    var tsFilter = {};
    if (req.body.timesheetId) {
      tsFilter._id = req.body.timesheetId;
    } else if (!req.body.ignoreDates) {
      tsFilter.date = { $gte: dayStart, $lte: dayEnd };
      if (req.body.startDate && req.body.endDate) {
        tsFilter.date = { $gte: new Date(req.body.startDate), $lte: new Date(req.body.endDate) };
      }
    }
    if (req.body.devFilter) {
      tsFilter.developer = req.body.devFilter;
    }
    if (req.body.projectFilter) {
      tsFilter.project = req.body.projectFilter;
    }

    // Get all timesheets for that day
    const timesheets = await Timesheet.find(tsFilter).populate('developer', 'name email role').populate('project', 'title description notes');

    const results = [];

    for (const ts of timesheets) {
      const project = ts.project;
      if (!project) continue;

      // Extract all notes context
      const notesText = (project.notes || []).map(n =>
        `[${n.addedByRole} - ${n.addedByName || 'Unknown'}]: ${n.text}`
      ).join('\n');

      let aiScore, health, aiFeedback, hasConcerns;

      if (ts.analysisStatus === 'analyzed' && ts.analysisResult) {
        aiScore = ts.analysisResult.aiScore;
        health = ts.analysisResult.health;
        aiFeedback = ts.analysisResult.aiFeedback;
        hasConcerns = ts.analysisResult.hasConcerns;
      } else {
        const analysis = await verifyTimesheetWithAI(
          ts.developer,
          project,
          ts.description || '',
          ts.onlineHours,
          ts.offlineHours
        );

        aiScore = analysis.score;
        health = analysis.health || (analysis.smoothScore >= 70 ? 'Good' : analysis.smoothScore >= 50 ? 'Fair' : 'Needs Attention');
        aiFeedback = analysis.feedback;
        hasConcerns = notesText.toLowerCase().includes('concern') || notesText.toLowerCase().includes('issue') || notesText.toLowerCase().includes('delay') || notesText.toLowerCase().includes('problem');

        ts.analysisStatus = 'analyzed';
        ts.analysisResult = {
          health,
          aiScore,
          aiFeedback,
          notesContext: notesText.substring(0, 500),
          hasConcerns,
          analyzedAt: new Date(),
          analyzedBy: 'owner'
        };
        await ts.save();
      }

      results.push({
        developer: ts.developer?.name || 'Unknown',
        developerId: ts.developer?._id,
        project: project.title,
        date: ts.date,
        onlineHours: ts.onlineHours,
        offlineHours: ts.offlineHours,
        totalHours: ts.totalHours,
        description: ts.description,
        aiScore,
        health,
        aiFeedback,
        notesContext: notesText.substring(0, 500),
        hasConcerns,
        status: ts.status
      });
    }

    // Summary stats
    const totalDevs = results.length;
    const healthyCount = results.filter(r => r.health === 'Good').length;
    const fairCount = results.filter(r => r.health === 'Fair').length;
    const needsAttention = results.filter(r => r.health === 'Needs Attention').length;
    const totalHours = results.reduce((s, r) => s + r.totalHours, 0);

    res.json({
      success: true,
      date: dayStart.toISOString().split('T')[0],
      summary: {
        totalDevs,
        healthyCount,
        fairCount,
        needsAttention,
        totalHours,
        reportGenerated: new Date().toISOString()
      },
      details: results
    });
  } catch (e) {
    res.json({ success: false, message: e.message });
  }
});

// All projects report (Owner and HR)
app.get('/api/reports/all', authMiddleware, roleMiddleware('owner', 'hr'), async (req, res) => {
  try {
    const projects = await Project.find().populate('salesManager bdm pm', 'name email').sort({ createdAt: -1 });
    const devs = await User.find({ role: 'dev', isActive: true }).select('name email');

    // Parse query params for month/year filtering
    let dateFilter = {};
    const queryYear = req.query.year;
    const queryMonth = req.query.month;

    if ((queryYear && queryYear !== 'all') || (queryMonth && queryMonth !== 'all')) {
      const year = queryYear && queryYear !== 'all' ? parseInt(queryYear) : new Date().getFullYear();
      if (queryMonth && queryMonth !== 'all') {
        const month = parseInt(queryMonth) - 1; // 0-indexed
        const start = new Date(year, month, 1);
        const end = new Date(year, month + 1, 0, 23, 59, 59, 999);
        dateFilter = { $gte: start, $lte: end };
      } else {
        const start = new Date(year, 0, 1);
        const end = new Date(year, 12, 0, 23, 59, 59, 999);
        dateFilter = { $gte: start, $lte: end };
      }
    } else if (queryYear === 'all' && queryMonth === 'all') {
      dateFilter = null;
    } else {
      const now = new Date();
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
      dateFilter = { $gte: start, $lte: end };
    }

    const timesheetFilter = {};
    if (dateFilter) {
      timesheetFilter.date = dateFilter;
    }

    const timesheetsQuery = Timesheet.find(timesheetFilter).populate('developer', 'name email').populate('project', 'title').sort({ date: -1 });
    if (!dateFilter) {
      timesheetsQuery.limit(200);
    }
    const timesheets = await timesheetsQuery;

    // Calculate total hours of matching timesheets
    const totalHoursResult = await Timesheet.aggregate([
      { $match: timesheetFilter },
      { $group: { _id: null, total: { $sum: '$totalHours' } } }
    ]);
    const totalHours = totalHoursResult.length > 0 ? totalHoursResult[0].total : 0;

    const totalProjects = projects.length;
    const activeProjects = projects.filter(p => p.status !== 'completed' && p.status !== 'cancelled').length;
    const totalDevs = devs.length;

    res.json({
      success: true,
      stats: { totalProjects, activeProjects, totalDevs, totalHours, pendingApprovals: timesheets.filter(t => t.status === 'pending').length },
      projects, devs, recentTimesheets: timesheets
    });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

// ==========================================
// SEED DEFAULT USERS
// ==========================================
async function seedUsers() {
  console.log('Seeding default and requested users...');

  // Base default users
  const defaultUsers = [
    { name: 'Company Owner', email: 'owner@company.com', password: 'owner123', role: 'owner' },
    { name: 'HR Manager', email: 'hr@company.com', password: 'hr123', role: 'hr' },
    { name: 'Sales Manager', email: 'sales@company.com', password: 'sales123', role: 'sales' },
    { name: 'BDM User', email: 'bdm@company.com', password: 'bdm123', role: 'bdm' },
    { name: 'PM User', email: 'pm@company.com', password: 'pm123', role: 'pm' },
    { name: 'Dev User', email: 'dev@company.com', password: 'dev123', role: 'dev' },
  ];

  // Requested users with password '123456'
  const requestedUsers = [
    // sales manager - Latif ,Rohit, pawan
    { name: 'Latif', email: 'latif@company.com', password: '123456', role: 'sales' },
    { name: 'Rohit', email: 'rohit@company.com', password: '123456', role: 'sales' },
    { name: 'Pawan', email: 'pawan@company.com', password: '123456', role: 'sales' },

    // bdm - Prashant , arif
    { name: 'Prashant', email: 'prashant@company.com', password: '123456', role: 'bdm' },
    { name: 'Arif', email: 'arif@company.com', password: '123456', role: 'bdm' },

    // pm - harmeet, Gagandeep , raman , sumitrana , sahilthakur
    { name: 'Harmeet', email: 'harmeet@company.com', password: '123456', role: 'pm' },
    { name: 'Gagandeep', email: 'gagandeep@company.com', password: '123456', role: 'pm' },
    { name: 'Raman', email: 'raman@company.com', password: '123456', role: 'pm' },
    { name: 'Sumitrana', email: 'sumitrana@company.com', password: '123456', role: 'pm' },
    { name: 'Sahil Thakur', email: 'sahilthakur@company.com', password: '123456', role: 'pm' },

    // dev- Gaurav , Ishan ,ajesh , sachin , vishwash , divyanshu
    { name: 'Gaurav', email: 'gaurav@company.com', password: '123456', role: 'dev' },
    { name: 'Ishan', email: 'ishan@company.com', password: '123456', role: 'dev' },
    { name: 'Ajesh', email: 'ajesh@company.com', password: '123456', role: 'dev' },
    { name: 'Sachin', email: 'sachin@company.com', password: '123456', role: 'dev' },
    { name: 'Vishwash', email: 'vishwash@company.com', password: '123456', role: 'dev' },
    { name: 'Divyanshu', email: 'divyanshu@company.com', password: '123456', role: 'dev' },

    // hr - Rahul , danish
    { name: 'Rahul', email: 'rahul@company.com', password: '123456', role: 'hr' },
    { name: 'Danish', email: 'danish@company.com', password: '123456', role: 'hr' }
  ];

  const allToSeed = [...defaultUsers, ...requestedUsers];

  for (const u of allToSeed) {
    const exists = await User.findOne({ email: u.email });
    if (!exists) {
      const hashed = await bcrypt.hash(u.password, 10);
      await User.create({
        name: u.name,
        email: u.email,
        password: hashed,
        role: u.role
      });
      console.log(`Created user: ${u.name} (${u.role})`);
    }
  }
  console.log('✓ Seeding check finished');
}


// ==========================================
// LEAVE MANAGEMENT ROUTES
// ==========================================

// POST /api/leaves — submit a leave request
app.post('/api/leaves', authMiddleware, async (req, res) => {
  try {
    const { date, reason } = req.body;
    if (!date) return res.json({ success: false, message: 'Date is required' });
    const leave = await Leave.create({ applicant: req.user._id, date: new Date(date), reason: reason || '' });
    res.json({ success: true, leave });
  } catch (e) {
    console.error('Leave POST error:', e);
    res.json({ success: false, message: e.message });
  }
});

// GET /api/leaves — fetch leaves (own for dev; all for owner/hr/pm/bdm/sales)
app.get('/api/leaves', authMiddleware, async (req, res) => {
  try {
    const managerRoles = ['owner', 'hr', 'pm', 'bdm', 'sales'];
    let filter = {};
    if (!managerRoles.includes(req.user.role)) {
      filter.applicant = req.user._id;
    }
    const leaves = await Leave.find(filter)
      .populate('applicant', 'name role email')
      .populate('approvedBy', 'name role')
      .sort({ createdAt: -1 });
    res.json({ success: true, leaves });
  } catch (e) {
    console.error('Leave GET error:', e);
    res.json({ success: false, message: e.message });
  }
});

// PUT /api/leaves/:id/approve — approve or reject a leave
app.put('/api/leaves/:id/approve', authMiddleware, async (req, res) => {
  try {
    const allowed = ['owner', 'hr', 'pm', 'bdm', 'sales'];
    if (!allowed.includes(req.user.role)) {
      return res.json({ success: false, message: 'Not authorized' });
    }
    const { status } = req.body;
    if (!['approved', 'rejected'].includes(status)) {
      return res.json({ success: false, message: 'Invalid status' });
    }
    const leave = await Leave.findByIdAndUpdate(
      req.params.id,
      {
        status,
        approvedBy: req.user._id,
        approvedByName: req.user.name,
        approvedByRole: req.user.role
      },
      { new: true }
    ).populate('applicant', 'name role email').populate('approvedBy', 'name role');
    if (!leave) return res.json({ success: false, message: 'Leave not found' });
    res.json({ success: true, leave });
  } catch (e) {
    console.error('Leave PUT error:', e);
    res.json({ success: false, message: e.message });
  }
});

// ==========================================
// NOTICES ROUTES
// ==========================================

// Create notice (HR / Owner only)
app.post('/api/notices', authMiddleware, roleMiddleware('owner', 'hr'), async (req, res) => {
  try {
    const { title, message, type, color, targetType, targetUser } = req.body;
    if (!title || !message) {
      return res.json({ success: false, message: 'Title and message are required' });
    }

    const notice = await Notice.create({
      title,
      message,
      type: type || 'notification',
      color: color || '#0ea5e9',
      sentBy: req.user._id,
      sentByName: req.user.name,
      sentByRole: req.user.role,
      targetType: targetType || 'all',
      targetUser: targetType === 'individual' ? targetUser : undefined
    });

    res.json({ success: true, notice });
  } catch (e) {
    console.error('Notice creation error:', e);
    res.json({ success: false, message: e.message });
  }
});

// Get notices targeting current user (Global notices + personal notices)
app.get('/api/notices', authMiddleware, async (req, res) => {
  try {
    const userId = req.user._id;
    const notices = await Notice.find({
      $or: [
        { targetType: 'all' },
        { targetType: 'individual', targetUser: userId }
      ]
    }).sort({ createdAt: -1 });

    res.json({ success: true, notices });
  } catch (e) {
    console.error('Fetch notices error:', e);
    res.json({ success: false, message: e.message });
  }
});

// Get all sent notices (For management: Owner/HR only)
app.get('/api/notices/all', authMiddleware, roleMiddleware('owner', 'hr'), async (req, res) => {
  try {
    const notices = await Notice.find()
      .populate('targetUser', 'name email role')
      .sort({ createdAt: -1 });
    res.json({ success: true, notices });
  } catch (e) {
    console.error('Fetch all notices error:', e);
    res.json({ success: false, message: e.message });
  }
});

// Delete a notice (HR / Owner only)
app.delete('/api/notices/:id', authMiddleware, roleMiddleware('owner', 'hr'), async (req, res) => {
  try {
    const notice = await Notice.findByIdAndDelete(req.params.id);
    if (!notice) return res.json({ success: false, message: 'Notice not found' });
    res.json({ success: true, message: 'Notice deleted successfully' });
  } catch (e) {
    console.error('Delete notice error:', e);
    res.json({ success: false, message: e.message });
  }
});

// ==========================================
// SUGGESTIONS ROUTES
// ==========================================

// Submit anonymous suggestion (Any user)
app.post('/api/suggestions', authMiddleware, async (req, res) => {
  try {
    const { message } = req.body;
    if (!message || message.trim() === '') {
      return res.json({ success: false, message: 'Suggestion message is required' });
    }

    const suggestion = await Suggestion.create({
      message,
      senderId: req.user._id // Stored in database, but excluded from client fetches
    });

    res.json({ success: true, message: 'Suggestion submitted successfully' });
  } catch (e) {
    console.error('Suggestion creation error:', e);
    res.json({ success: false, message: e.message });
  }
});

// Get suggestions (For management: Owner/HR only)
app.get('/api/suggestions', authMiddleware, roleMiddleware('owner', 'hr'), async (req, res) => {
  try {
    const suggestions = await Suggestion.find({}, { senderId: 0 }) // Exclude senderId to ensure anonymity
      .sort({ createdAt: -1 });
    res.json({ success: true, suggestions });
  } catch (e) {
    console.error('Fetch suggestions error:', e);
    res.json({ success: false, message: e.message });
  }
});

// ==========================================
// START SERVER
// ==========================================


app.listen(PORT, async () => {
  console.log(`\n========================================`);
  console.log(`  IT COMPANY CRM`);
  console.log(`========================================`);
  console.log(`Server: http://localhost:${PORT}`);
  console.log(`MongoDB: ${MONGODB_URI}`);
  console.log(`========================================\n`);
  await seedUsers();

  // ── Daily cron: auto-analyze all pending timesheets at 23:59 ──
  cron.schedule('59 23 * * *', async () => {
    console.log('\n[CRON] 23:59 — Running daily auto-analysis...');
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);
    try {
      const pending = await Timesheet.find({
        date: { $gte: todayStart, $lte: todayEnd },
        analysisStatus: 'pending'
      });
      console.log(`[CRON] Found ${pending.length} pending timesheets to auto-analyze.`);
      for (const ts of pending) {
        try {
          await runSingleTimesheetAnalysis(ts._id, 'cron');
          console.log(`[CRON] ✓ Analyzed timesheet ${ts._id}`);
        } catch (err) {
          console.error(`[CRON] ✗ Failed ${ts._id}:`, err.message);
        }
      }
      console.log('[CRON] Auto-analysis complete.\n');
    } catch (e) {
      console.error('[CRON] Error:', e.message);
    }
  });
  console.log('✓ Daily cron scheduled at 23:59');
});