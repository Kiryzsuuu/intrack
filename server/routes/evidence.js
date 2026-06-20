const router   = require('express').Router();
const path     = require('path');
const Evidence = require('../models/Evidence');
const Task     = require('../models/Task');
const auth     = require('../middleware/auth');
const { upload } = require('../middleware/upload');

// Req #3: semua user bisa melihat task & evidence
function canAccessEvidence() { return true; }

function canEditEvidence(user, task) {
  if (['direksi', 'superadmin'].includes(user.role)) return true;
  if ((task.dibuatOleh?.toString() || '') === user._id.toString()) return true;
  return (task.assignees || []).map(c => c.toString()).includes(user._id.toString());
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

  // Hanya assignee/creator yang bisa upload
  if (!canEditEvidence(req.user, task))
    return res.status(403).json({ message: 'Hanya assignee atau pembuat yang dapat upload file' });

  if (task.status === 'complete' && req.user.role !== 'direksi')
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

  if (task.status === 'complete') {
    if (req.user.role !== 'direksi')
      return res.status(403).json({ message: 'File task selesai hanya dapat dihapus oleh Direksi' });
  } else {
    if (!canEditEvidence(req.user, task))
      return res.status(403).json({ message: 'Hanya assignee atau pembuat yang dapat menghapus file' });
  }

  // Hapus file fisik
  const fs = require('fs');
  const filePath = path.join(__dirname, '../../', ev.urlFile);
  fs.unlink(filePath, () => {});

  await ev.deleteOne();
  res.json({ message: 'Evidence dihapus' });
});

module.exports = router;
