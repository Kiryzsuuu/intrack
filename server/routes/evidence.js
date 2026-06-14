const router   = require('express').Router();
const path     = require('path');
const Evidence = require('../models/Evidence');
const Task     = require('../models/Task');
const auth     = require('../middleware/auth');
const { upload } = require('../middleware/upload');

function canAccessEvidence(user, task) {
  if (user.role === 'direksi') return true;
  const userDir = user.direktoratId?._id?.toString() || user.direktoratId?.toString();
  const taskDir = task.direktoratId?.toString();
  if (userDir !== taskDir) return false;
  const isCollab = (task.collaborators || []).map(c => c.toString()).includes(user._id.toString());
  return task.picUserId.toString() === user._id.toString() || isCollab;
}

// GET /api/evidence?taskId=xxx
router.get('/', auth, async (req, res) => {
  const { taskId } = req.query;
  if (!taskId) return res.status(400).json({ message: 'taskId wajib' });

  const task = await Task.findById(taskId);
  if (!task) return res.status(404).json({ message: 'Task tidak ditemukan' });
  if (!canAccessEvidence(req.user, task))
    return res.status(403).json({ message: 'Akses ditolak' });

  const evidences = await Evidence.find({ taskId }).populate('uploaderId', 'namaLengkap').sort({ createdAt: -1 });
  res.json(evidences);
});

// POST /api/evidence — upload file
router.post('/', auth, upload.single('file'), async (req, res) => {
  const { taskId } = req.body;
  if (!taskId) return res.status(400).json({ message: 'taskId wajib' });
  if (!req.file) return res.status(400).json({ message: 'File wajib diupload' });

  const task = await Task.findById(taskId);
  if (!task || task.isDeleted)
    return res.status(404).json({ message: 'Task tidak ditemukan' });

  // Hanya PIC yang bisa upload
  if (task.picUserId.toString() !== req.user._id.toString() && req.user.role !== 'direksi')
    return res.status(403).json({ message: 'Hanya PIC yang dapat upload evidence' });

  if (task.status === 'done' && req.user.role !== 'direksi')
    return res.status(400).json({ message: 'Task sudah Done, tidak dapat upload evidence baru' });

  // Cek limit 10 file
  const count = await Evidence.countDocuments({ taskId });
  if (count >= 10)
    return res.status(400).json({ message: 'Maksimal 10 file evidence per task' });

  const ev = await Evidence.create({
    taskId,
    uploaderId: req.user._id,
    namaFile:   req.file.originalname,
    urlFile:    `/uploads/evidence/${req.file.filename}`,
    ukuran:     req.file.size,
    mimeType:   req.file.mimetype,
  });

  res.status(201).json(ev);
});

// DELETE /api/evidence/:id
router.delete('/:id', auth, async (req, res) => {
  const ev   = await Evidence.findById(req.params.id);
  if (!ev) return res.status(404).json({ message: 'Evidence tidak ditemukan' });

  const task = await Task.findById(ev.taskId);
  const isPIC = task.picUserId.toString() === req.user._id.toString();

  if (task.status === 'done') {
    if (req.user.role !== 'direksi')
      return res.status(403).json({ message: 'Evidence task Done hanya dapat dihapus oleh Direksi' });
  } else {
    if (!isPIC && req.user.role !== 'direksi')
      return res.status(403).json({ message: 'Hanya PIC yang dapat menghapus evidence' });
  }

  // Hapus file fisik
  const fs = require('fs');
  const filePath = path.join(__dirname, '../../', ev.urlFile);
  fs.unlink(filePath, () => {});

  await ev.deleteOne();
  res.json({ message: 'Evidence dihapus' });
});

module.exports = router;
