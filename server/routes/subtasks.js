const router  = require('express').Router();
const Subtask = require('../models/Subtask');
const Task    = require('../models/Task');
const auth    = require('../middleware/auth');

function isPIC(user, task) {
  return task.picUserId.toString() === user._id.toString();
}

// GET /api/subtasks?taskId=xxx
router.get('/', auth, async (req, res) => {
  const { taskId } = req.query;
  if (!taskId) return res.status(400).json({ message: 'taskId wajib' });
  const subtasks = await Subtask.find({ taskId }).sort({ urutan: 1 });
  res.json(subtasks);
});

// POST /api/subtasks
router.post('/', auth, async (req, res) => {
  const { taskId, judul } = req.body;
  if (!taskId || !judul) return res.status(400).json({ message: 'taskId dan judul wajib' });

  const task = await Task.findById(taskId);
  if (!task) return res.status(404).json({ message: 'Task tidak ditemukan' });

  if (!isPIC(req.user, task) && req.user.role !== 'direksi')
    return res.status(403).json({ message: 'Hanya PIC yang dapat menambah subtask' });

  const last = await Subtask.findOne({ taskId }).sort({ urutan: -1 });
  const urutan = last ? last.urutan + 1 : 0;

  const sub = await Subtask.create({ taskId, judul, urutan });
  res.status(201).json(sub);
});

// PUT /api/subtasks/:id
router.put('/:id', auth, async (req, res) => {
  const sub = await Subtask.findById(req.params.id);
  if (!sub) return res.status(404).json({ message: 'Subtask tidak ditemukan' });

  const task = await Task.findById(sub.taskId);
  if (!isPIC(req.user, task) && req.user.role !== 'direksi')
    return res.status(403).json({ message: 'Hanya PIC yang dapat mengubah subtask' });

  if (req.body.judul  !== undefined) sub.judul  = req.body.judul;
  if (req.body.isDone !== undefined) sub.isDone = req.body.isDone;
  if (req.body.urutan !== undefined) sub.urutan = req.body.urutan;
  await sub.save();
  res.json(sub);
});

// DELETE /api/subtasks/:id
router.delete('/:id', auth, async (req, res) => {
  const sub = await Subtask.findById(req.params.id);
  if (!sub) return res.status(404).json({ message: 'Subtask tidak ditemukan' });

  const task = await Task.findById(sub.taskId);
  if (!isPIC(req.user, task) && req.user.role !== 'direksi')
    return res.status(403).json({ message: 'Hanya PIC yang dapat menghapus subtask' });

  await sub.deleteOne();
  res.json({ message: 'Subtask dihapus' });
});

// PUT /api/subtasks/reorder — drag-and-drop reorder
router.put('/reorder/batch', auth, async (req, res) => {
  const { items } = req.body; // [{ _id, urutan }]
  if (!Array.isArray(items)) return res.status(400).json({ message: 'items harus array' });
  await Promise.all(items.map(i => Subtask.findByIdAndUpdate(i._id, { urutan: i.urutan })));
  res.json({ message: 'Urutan diupdate' });
});

module.exports = router;
