require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');

const app = express();
const port = process.env.PORT || 5000;
const jwtSecret = process.env.JWT_SECRET || 'your-secret-key';

// Middleware
app.use(cors());
app.use(express.json());

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Middleware to verify JWT token
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.sendStatus(401);
  }

  jwt.verify(token, jwtSecret, (err, user) => {
    if (err) return res.sendStatus(403);
    req.user = user;
    next();
  });
};

// AUTH ROUTES
// Register Organization
app.post('/api/register/org', async (req, res) => {
  const { name, email, password, description } = req.body;
  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const result = await pool.query(
      'INSERT INTO organizations (name, email, password_hash, description) VALUES ($1, $2, $3, $4) RETURNING id, name, email, description',
      [name, email, hashedPassword, description]
    );
    const token = jwt.sign({ userId: result.rows[0].id, userType: 'org' }, jwtSecret);
    res.status(201).json({ user: result.rows[0], token });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Email already exists or registration failed' });
  }
});

// Register Volunteer
app.post('/api/register/volunteer', async (req, res) => {
  const { name, email, password, interests } = req.body;
  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const result = await pool.query(
      'INSERT INTO volunteers (name, email, password_hash, interests) VALUES ($1, $2, $3, $4) RETURNING id, name, email, interests',
      [name, email, hashedPassword, interests]
    );
    const token = jwt.sign({ userId: result.rows[0].id, userType: 'volunteer' }, jwtSecret);
    res.status(201).json({ user: result.rows[0], token });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// Login
app.post('/api/login', async (req, res) => {
  const { email, password, userType } = req.body;
  const table = userType === 'org' ? 'organizations' : 'volunteers';
  try {
    const result = await pool.query(`SELECT * FROM ${table} WHERE email = $1`, [email]);
    const user = result.rows[0];

    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(400).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign({ userId: user.id, userType }, jwtSecret);
    const { password_hash, ...userWithoutPassword } = user;
    res.json({ user: userWithoutPassword, token });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// EVENT ROUTES
// Create Event (Org only)
app.post('/api/events', authenticateToken, async (req, res) => {
  if (req.user.userType !== 'org') return res.sendStatus(403);

  const { title, description, date, location, roles } = req.body;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 1. Insert the event
    const eventResult = await client.query(
      'INSERT INTO events (organizer_id, title, description, date, location) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [req.user.userId, title, description, date, location]
    );
    const newEvent = eventResult.rows[0];

    // 2. Insert all roles for this event
    for (const role of roles) {
      await client.query(
        'INSERT INTO roles (event_id, name, description, required_volunteers) VALUES ($1, $2, $3, $4)',
        [newEvent.id, role.name, role.description, role.requiredVolunteers]
      );
    }

    await client.query('COMMIT');
    res.status(201).json(newEvent);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Failed to create event' });
  } finally {
    client.release();
  }
});

// Get All Events (with role counts)
app.get('/api/events', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT e.*, o.name as organizer_name,
      (SELECT COUNT(*) FROM roles r WHERE r.event_id = e.id) as role_count
      FROM events e
      JOIN organizations o ON e.organizer_id = o.id
      WHERE e.date > NOW()
      ORDER BY e.date ASC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch events' });
  }
});

// Get Single Event with Roles and Volunteer Count
app.get('/api/events/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const eventResult = await pool.query(`
      SELECT e.*, o.name as organizer_name 
      FROM events e 
      JOIN organizations o ON e.organizer_id = o.id 
      WHERE e.id = $1
    `, [id]);
    const rolesResult = await pool.query(`
      SELECT r.*, 
      (SELECT COUNT(*) FROM volunteer_roles vr WHERE vr.role_id = r.id) as current_volunteers
      FROM roles r 
      WHERE r.event_id = $1
    `, [id]);

    if (eventResult.rows.length === 0) {
      return res.status(404).json({ error: 'Event not found' });
    }

    res.json({
      ...eventResult.rows[0],
      roles: rolesResult.rows
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch event' });
  }
});

// VOLUNTEER ROUTES
// Sign up for a Role
app.post('/api/roles/:roleId/signup', authenticateToken, async (req, res) => {
  if (req.user.userType !== 'volunteer') return res.sendStatus(403);
  const { roleId } = req.params;

  try {
    // Check if volunteer is already signed up for this role
    const existingSignup = await pool.query(
      'SELECT * FROM volunteer_roles WHERE volunteer_id = $1 AND role_id = $2',
      [req.user.userId, roleId]
    );

    if (existingSignup.rows.length > 0) {
      return res.status(400).json({ error: 'Already signed up for this role' });
    }

    await pool.query(
      'INSERT INTO volunteer_roles (volunteer_id, role_id) VALUES ($1, $2)',
      [req.user.userId, roleId]
    );
    res.status(201).json({ message: 'Successfully signed up for role' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to sign up for role' });
  }
});

// Get Volunteer's Events and Stats
app.get('/api/volunteer/profile', authenticateToken, async (req, res) => {
  if (req.user.userType !== 'volunteer') return res.sendStatus(403);

  try {
    // Get upcoming events where volunteer is signed up
    const upcomingEvents = await pool.query(`
      SELECT e.*, r.name as role_name, vr.role_id, vr.attended
      FROM events e
      JOIN roles r ON r.event_id = e.id
      JOIN volunteer_roles vr ON vr.role_id = r.id
      WHERE vr.volunteer_id = $1 AND e.date > NOW()
      ORDER BY e.date ASC
    `, [req.user.userId]);

    // Get past events and stats
    const pastEvents = await pool.query(`
      SELECT e.*, r.name as role_name, vr.attended
      FROM events e
      JOIN roles r ON r.event_id = e.id
      JOIN volunteer_roles vr ON vr.role_id = r.id
      WHERE vr.volunteer_id = $1 AND e.date <= NOW()
      ORDER BY e.date DESC
    `, [req.user.userId]);

    const totalEventsAttended = pastEvents.rows.filter(event => event.attended).length;
    const totalHours = totalEventsAttended * 3; // Simplified calculation

    res.json({
      upcoming: upcomingEvents.rows,
      past: pastEvents.rows,
      stats: {
        totalEvents: totalEventsAttended,
        totalHours: totalHours
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch profile data' });
  }
});

// COORDINATOR ROUTES
// Get Event Volunteers for Coordinator
app.get('/api/events/:eventId/volunteers', authenticateToken, async (req, res) => {
  // Check if user is the organizer of this event
  const { eventId } = req.params;
  try {
    const eventCheck = await pool.query(
      'SELECT organizer_id FROM events WHERE id = $1',
      [eventId]
    );

    if (eventCheck.rows.length === 0 || eventCheck.rows[0].organizer_id !== req.user.userId) {
      return res.sendStatus(403);
    }

    const result = await pool.query(`
      SELECT v.id, v.name, v.email, r.name as role_name, vr.attended, vr.id as record_id
      FROM volunteers v
      JOIN volunteer_roles vr ON v.id = vr.volunteer_id
      JOIN roles r ON vr.role_id = r.id
      WHERE r.event_id = $1
      ORDER BY r.name, v.name
    `, [eventId]);

    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch volunteers' });
  }
});

// Mark Attendance
app.patch('/api/attendance/:recordId', authenticateToken, async (req, res) => {
  const { recordId } = req.params;
  const { attended } = req.body;

  try {
    // First, verify the user has rights to modify this attendance record
    const recordCheck = await pool.query(`
      SELECT e.organizer_id 
      FROM volunteer_roles vr
      JOIN roles r ON vr.role_id = r.id
      JOIN events e ON r.event_id = e.id
      WHERE vr.id = $1
    `, [recordId]);

    if (recordCheck.rows.length === 0 || recordCheck.rows[0].organizer_id !== req.user.userId) {
      return res.sendStatus(403);
    }

    await pool.query(
      'UPDATE volunteer_roles SET attended = $1 WHERE id = $2',
      [attended, recordId]
    );
    res.json({ message: 'Attendance updated successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update attendance' });
  }
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
