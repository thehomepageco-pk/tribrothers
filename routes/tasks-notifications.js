const express = require('express');
const Task = require('../models/Task');
const Notification = require('../models/Notification');
const User = require('../models/User');
const { requirePermission } = require('../middleware/auth');

const router = express.Router();
const canEdit = requirePermission('canEdit');
const canDelete = requirePermission('canDelete');

const DONE_RETENTION_MS = 3 * 24 * 60 * 60 * 1000;

function isAdmin(req) {
  return req.session?.role === 'admin';
}

function populateTask(q) {
  return q
    .populate('assignee', 'username displayName email role')
    .populate('createdBy', 'username displayName');
}

async function purgeOldDoneTasks() {
  const cutoff = new Date(Date.now() - DONE_RETENTION_MS);
  await Task.deleteMany({ status: 'Done', completedAt: { $lt: cutoff } });
}

function formatDue(dueDate) {
  if (!dueDate) return '';
  try {
    return new Date(dueDate).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return '';
  }
}

async function notifyAssignment({ assigneeId, actorUserId, actorName, task }) {
  if (!assigneeId) return;
  if (actorUserId && String(assigneeId) === String(actorUserId)) return;
  const due = formatDue(task.dueDate);
  const duePart = due ? ` Due ${due}.` : '';
  await Notification.create({
    userId: assigneeId,
    title: 'Task assigned to you',
    message: `${actorName || 'Admin'} assigned you “${task.title}”.${duePart}`,
    type: 'task',
    href: '/',
    taskId: task._id,
    meta: {
      taskTitle: task.title,
      dueDate: task.dueDate || null,
    },
  });
}

async function notifyAdminsTaskCompleted({ task, actorUserId, actorName }) {
  const admins = await User.find({ role: 'admin', isActive: { $ne: false } })
    .select('_id')
    .lean();
  if (!admins.length) return;

  const who = actorName || 'Someone';
  const title = 'Task completed';
  const message = `${who} marked “${task.title}” as completed.`;
  const docs = admins
    .filter((a) => !actorUserId || String(a._id) !== String(actorUserId))
    .map((a) => ({
      userId: a._id,
      title,
      message,
      type: 'task',
      href: '/tasks',
      taskId: task._id,
      meta: {
        taskTitle: task.title,
        completedBy: who,
        completedAt: task.completedAt || new Date(),
      },
    }));
  if (docs.length) await Notification.insertMany(docs);
}

function canChangeTaskStatus(req, task) {
  if (isAdmin(req)) return true;
  if (req.session?.permissions?.canEdit) return true;
  const assigneeId = task.assignee ? String(task.assignee) : '';
  return Boolean(assigneeId && assigneeId === String(req.session.userId));
}

async function applyTaskStatus(task, status, req) {
  const prev = task.status;
  task.status = status;
  if (status === 'Done') {
    if (!task.completedAt) task.completedAt = new Date();
  } else {
    task.completedAt = null;
  }
  await task.save();

  if (status === 'Done' && prev !== 'Done') {
    await notifyAdminsTaskCompleted({
      task,
      actorUserId: req.session.userId,
      actorName: req.session.displayName || req.session.username || 'Someone',
    });
  }
  return task;
}

router.get('/users/assignable', async (req, res) => {
  try {
    const users = await User.find({ isActive: { $ne: false } })
      .select('username displayName email role')
      .sort({ displayName: 1, username: 1 })
      .lean();
    res.json(users);
  } catch (err) {
    console.error('❌ assignable users:', err);
    res.status(500).json({ error: 'Failed to load users' });
  }
});

router.get('/tasks/summary', async (req, res) => {
  try {
    await purgeOldDoneTasks();
    const now = new Date();
    const [todo, progress, done, overdue] = await Promise.all([
      Task.countDocuments({ status: 'Todo' }),
      Task.countDocuments({ status: 'In progress' }),
      Task.countDocuments({ status: 'Done' }),
      Task.countDocuments({
        status: { $in: ['Todo', 'In progress'] },
        dueDate: { $lt: now },
      }),
    ]);
    res.json({ todo, progress, done, overdue });
  } catch (err) {
    console.error('❌ tasks summary:', err);
    res.status(500).json({ error: 'Failed to load summary' });
  }
});

router.get('/tasks', async (req, res) => {
  try {
    await purgeOldDoneTasks();
    const tasks = await populateTask(
      Task.find({}).sort({ updatedAt: -1 }).limit(500),
    ).lean();
    res.json(tasks);
  } catch (err) {
    console.error('❌ list tasks:', err);
    res.status(500).json({ error: 'Failed to load tasks' });
  }
});

router.post('/tasks', canEdit, async (req, res) => {
  try {
    const title = String(req.body?.title || '').trim();
    if (!title) return res.status(400).json({ error: 'Title is required' });

    let assignee = req.body?.assignee || null;
    if (assignee && !isAdmin(req)) {
      return res.status(403).json({ error: 'Only admins can assign tasks' });
    }
    if (assignee === '') assignee = null;

    const status = ['Todo', 'In progress', 'Done', 'Cancelled'].includes(req.body?.status)
      ? req.body.status
      : 'Todo';
    const priority = ['Low', 'Medium', 'High', 'Urgent'].includes(req.body?.priority)
      ? req.body.priority
      : 'Medium';

    const task = await Task.create({
      title,
      description: String(req.body?.description || '').trim(),
      status,
      priority,
      dueDate: req.body?.dueDate ? new Date(req.body.dueDate) : null,
      assignee,
      createdBy: req.session.userId,
      completedAt: status === 'Done' ? new Date() : null,
    });

    if (assignee) {
      await notifyAssignment({
        assigneeId: assignee,
        actorUserId: req.session.userId,
        actorName: req.session.displayName || req.session.username || 'Admin',
        task,
      });
    }
    if (status === 'Done') {
      await notifyAdminsTaskCompleted({
        task,
        actorUserId: req.session.userId,
        actorName: req.session.displayName || req.session.username || 'Someone',
      });
    }

    const populated = await populateTask(Task.findById(task._id)).lean();
    res.status(201).json(populated);
  } catch (err) {
    console.error('❌ create task:', err);
    res.status(500).json({ error: 'Failed to create task' });
  }
});

router.put('/tasks/:id', canEdit, async (req, res) => {
  try {
    const task = await Task.findById(req.params.id);
    if (!task) return res.status(404).json({ error: 'Task not found' });

    if (req.body?.title !== undefined) {
      const title = String(req.body.title).trim();
      if (!title) return res.status(400).json({ error: 'Title is required' });
      task.title = title;
    }
    if (req.body?.description !== undefined) task.description = String(req.body.description).trim();
    if (req.body?.priority !== undefined && ['Low', 'Medium', 'High', 'Urgent'].includes(req.body.priority)) {
      task.priority = req.body.priority;
    }
    const prevStatus = task.status;
    if (req.body?.status !== undefined && ['Todo', 'In progress', 'Done', 'Cancelled'].includes(req.body.status)) {
      task.status = req.body.status;
      if (req.body.status === 'Done') {
        if (!task.completedAt) task.completedAt = new Date();
      } else {
        task.completedAt = null;
      }
    }
    if (req.body?.dueDate !== undefined) {
      task.dueDate = req.body.dueDate ? new Date(req.body.dueDate) : null;
    }

    let assignedChanged = false;
    if (req.body?.assignee !== undefined) {
      if (!isAdmin(req)) {
        return res.status(403).json({ error: 'Only admins can assign tasks' });
      }
      const next = req.body.assignee || null;
      const prev = task.assignee ? String(task.assignee) : '';
      task.assignee = next || null;
      assignedChanged = Boolean(next && String(next) !== prev);
    }

    await task.save();
    if (assignedChanged) {
      await notifyAssignment({
        assigneeId: task.assignee,
        actorUserId: req.session.userId,
        actorName: req.session.displayName || req.session.username || 'Admin',
        task,
      });
    }
    if (task.status === 'Done' && prevStatus !== 'Done') {
      await notifyAdminsTaskCompleted({
        task,
        actorUserId: req.session.userId,
        actorName: req.session.displayName || req.session.username || 'Someone',
      });
    }
    const populated = await populateTask(Task.findById(task._id)).lean();
    res.json(populated);
  } catch (err) {
    console.error('❌ update task:', err);
    res.status(500).json({ error: 'Failed to update task' });
  }
});

/** Mark complete / reopen — assignee can do this even without full canEdit. */
router.post('/tasks/:id/status', async (req, res) => {
  try {
    if (!req.session?.isAuthenticated) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    const status = req.body?.status;
    if (!['Todo', 'In progress', 'Done', 'Cancelled'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }
    const task = await Task.findById(req.params.id);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    if (!canChangeTaskStatus(req, task)) {
      return res.status(403).json({ error: 'You can only update status on tasks assigned to you' });
    }
    await applyTaskStatus(task, status, req);
    const populated = await populateTask(Task.findById(task._id)).lean();
    res.json(populated);
  } catch (err) {
    console.error('❌ task status:', err);
    res.status(500).json({ error: 'Failed to update task status' });
  }
});

router.delete('/tasks/:id', canDelete, async (req, res) => {
  try {
    const task = await Task.findByIdAndDelete(req.params.id);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    res.json({ success: true });
  } catch (err) {
    console.error('❌ delete task:', err);
    res.status(500).json({ error: 'Failed to delete task' });
  }
});

router.get('/notifications', async (req, res) => {
  try {
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 40));
    const userId = req.session.userId;
    const items = await Notification.find({ userId }).sort({ createdAt: -1 }).limit(limit).lean();
    const unreadCount = await Notification.countDocuments({ userId, read: false });
    res.json({ items, unreadCount });
  } catch (err) {
    console.error('❌ list notifications:', err);
    res.status(500).json({ error: 'Failed to load notifications' });
  }
});

router.post('/notifications/read', async (req, res) => {
  try {
    const userId = req.session.userId;
    if (req.body?.all) {
      await Notification.updateMany({ userId, read: false }, { $set: { read: true } });
      return res.json({ success: true });
    }
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
    if (ids.length) {
      await Notification.updateMany({ userId, _id: { $in: ids } }, { $set: { read: true } });
    }
    res.json({ success: true });
  } catch (err) {
    console.error('❌ mark notifications read:', err);
    res.status(500).json({ error: 'Failed to update notifications' });
  }
});

router.post('/notifications/:id/read', async (req, res) => {
  try {
    await Notification.updateOne(
      { _id: req.params.id, userId: req.session.userId },
      { $set: { read: true } },
    );
    res.json({ success: true });
  } catch (err) {
    console.error('❌ mark notification read:', err);
    res.status(500).json({ error: 'Failed to update notification' });
  }
});

router.delete('/notifications', async (req, res) => {
  try {
    const userId = req.session.userId;
    await Notification.deleteMany({ userId });
    res.json({ success: true });
  } catch (err) {
    console.error('❌ clear notifications:', err);
    res.status(500).json({ error: 'Failed to clear notifications' });
  }
});

module.exports = router;
