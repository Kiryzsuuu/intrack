const router  = require('express').Router();
const TimeLog = require('../models/TimeLog');
const Task    = require('../models/Task');
const StatusLog = require('../models/StatusLog');
const auth    = require('../middleware/auth');

// GET /api/timelog?taskId=xxx
router.get('/', auth, async (req, res) => {
  const { taskId, userId, limit } = req.query;
  const filter = {};
  if (taskId) filter.taskId = taskId;
  if (userId) filter.userId = userId;
  // Default: own logs only, unless direksi/superadmin with no specific filter
  else if (!taskId) {
    const canViewAll = req.user.role === 'direksi' || req.user.role === 'superadmin';
    if (!canViewAll) filter.userId = req.user._id;
  }

  const logs = await TimeLog.find(filter)
    .populate('userId', 'namaLengkap fotoProfil')
    .sort({ tanggal: -1 })
    .limit(parseInt(limit) || 100);

  const totalMenit = logs.reduce((s, l) => s + l.durasiMenit, 0);
  res.json({ logs, totalMenit });
});

// POST /api/timelog — catat waktu
router.post('/', auth, async (req, res) => {
  const { taskId, durasiMenit, catatan, tanggal } = req.body;
  if (!taskId)      return res.status(400).json({ message: 'taskId wajib' });
  if (!durasiMenit) return res.status(400).json({ message: 'Durasi wajib diisi' });
  if (durasiMenit < 1) return res.status(400).json({ message: 'Durasi minimal 1 menit' });
  if (durasiMenit > 1440) return res.status(400).json({ message: 'Durasi maksimal 1440 menit (24 jam)' });

  const task = await Task.findById(taskId);
  if (!task || task.isDeleted) return res.status(404).json({ message: 'Task tidak ditemukan' });

  const isPIC   = task.picUserId.toString() === req.user._id.toString();
  const isCollab = (task.collaborators || []).map(c => c.toString()).includes(req.user._id.toString());
  const canLog  = isPIC || isCollab || req.user.role === 'direksi' || req.user.role === 'superadmin';
  if (!canLog) return res.status(403).json({ message: 'Hanya PIC atau collaborator yang dapat mencatat waktu' });

  const log = await TimeLog.create({
    taskId,
    userId: req.user._id,
    durasiMenit: parseInt(durasiMenit),
    catatan: catatan || '',
    tanggal: tanggal ? new Date(tanggal) : new Date(),
  });

  await log.populate('userId', 'namaLengkap fotoProfil');

  // Auto-set status ke on_progress saat pertama kali catat waktu
  if (task.status === 'to_do') {
    task.status = 'on_progress';
    await task.save();
    await StatusLog.create({ taskId, userId: req.user._id, statusLama: 'to_do', statusBaru: 'on_progress', catatan: 'Auto: time tracking dimulai' });
  }

  res.status(201).json(log);
});

// DELETE /api/timelog/:id
router.delete('/:id', auth, async (req, res) => {
  const log = await TimeLog.findById(req.params.id);
  if (!log) return res.status(404).json({ message: 'Log tidak ditemukan' });
  if (log.userId.toString() !== req.user._id.toString() && req.user.role !== 'superadmin')
    return res.status(403).json({ message: 'Tidak bisa hapus log orang lain' });
  await log.deleteOne();
  res.json({ message: 'Log dihapus' });
});

// GET /api/timelog/summary — ringkasan jam per task untuk workload
router.get('/summary', auth, async (req, res) => {
  const { userId, bulan, tahun } = req.query;
  const now = new Date();
  const m   = parseInt(bulan) || now.getMonth() + 1;
  const y   = parseInt(tahun) || now.getFullYear();
  const from = new Date(y, m - 1, 1);
  const to   = new Date(y, m, 0, 23, 59, 59);

  const match = { tanggal: { $gte: from, $lte: to } };
  if (userId) match.userId = require('mongoose').Types.ObjectId.createFromHexString(userId);
  else match.userId = req.user._id;

  const agg = await TimeLog.aggregate([
    { $match: match },
    { $group: { _id: '$taskId', totalMenit: { $sum: '$durasiMenit' }, entries: { $sum: 1 } } },
    { $lookup: { from: 'tasks', localField: '_id', foreignField: '_id', as: 'task' } },
    { $unwind: '$task' },
    { $project: { taskId: '$_id', judul: '$task.judul', status: '$task.status', totalMenit: 1, entries: 1 } },
    { $sort: { totalMenit: -1 } },
  ]);

  res.json({ summary: agg });
});

module.exports = router;
