const router  = require('express').Router();
const Subtask = require('../models/Subtask');
const Task    = require('../models/Task');
const auth    = require('../middleware/auth');

function idStr(v) { return v?._id?.toString() || v?.toString() || ''; }
function isCreator(user, task) { return idStr(task.dibuatOleh) === user._id.toString(); }
function isDireksi(user) { return ['direksi', 'superadmin'].includes(user.role); }
function canManage(user, task) { return isDireksi(user) || isCreator(user, task); }
function isSubAssignee(user, sub) {
  return (sub.assignees || []).map(idStr).includes(user._id.toString());
}

// GET /api/subtasks?taskId=xxx — semua subtask (termasuk nested) untuk task
router.get('/', auth, async (req, res) => {
  const { taskId } = req.query;
  if (!taskId) return res.status(400).json({ message: 'taskId wajib' });
  const subtasks = await Subtask.find({ taskId })
    .populate('assignees', 'namaLengkap fotoProfil')
    .sort({ urutan: 1 });
  res.json(subtasks);
});

// POST /api/subtasks — hanya creator task (req #11). Bisa nested via parentId.
router.post('/', auth, async (req, res) => {
  const { taskId, parentId, judul, assignees, dueDate, priority } = req.body;
  if (!taskId || !judul) return res.status(400).json({ message: 'taskId dan judul wajib' });

  const task = await Task.findById(taskId);
  if (!task) return res.status(404).json({ message: 'Task tidak ditemukan' });

  if (!canManage(req.user, task))
    return res.status(403).json({ message: 'Hanya pembuat task yang dapat menambah subtask' });

  // Validasi parent (jika nested) milik task yang sama
  if (parentId) {
    const parent = await Subtask.findById(parentId);
    if (!parent || parent.taskId.toString() !== taskId.toString())
      return res.status(400).json({ message: 'Parent subtask tidak valid' });
  }

  const last = await Subtask.findOne({ taskId, parentId: parentId || null }).sort({ urutan: -1 });
  const urutan = last ? last.urutan + 1 : 0;

  const sub = await Subtask.create({
    taskId, parentId: parentId || null, judul, urutan,
    assignees: assignees || [],
    dueDate: dueDate || null,
    priority: priority || 'medium',
  });
  await sub.populate('assignees', 'namaLengkap fotoProfil');
  res.status(201).json(sub);
});

// PUT /api/subtasks/reorder/batch — harus di atas /:id
router.put('/reorder/batch', auth, async (req, res) => {
  const { items } = req.body; // [{ _id, urutan }]
  if (!Array.isArray(items)) return res.status(400).json({ message: 'items harus array' });
  await Promise.all(items.map(i => Subtask.findByIdAndUpdate(i._id, { urutan: i.urutan })));
  res.json({ message: 'Urutan diupdate' });
});

// PUT /api/subtasks/:id
router.put('/:id', auth, async (req, res) => {
  const sub = await Subtask.findById(req.params.id);
  if (!sub) return res.status(404).json({ message: 'Subtask tidak ditemukan' });

  const task = await Task.findById(sub.taskId);
  if (!task) return res.status(404).json({ message: 'Task tidak ditemukan' });

  const manage = canManage(req.user, task);
  // Assignee subtask hanya boleh toggle isDone
  const onlyDoneChange = Object.keys(req.body).every(k => k === 'isDone');
  if (!manage && !(isSubAssignee(req.user, sub) && onlyDoneChange))
    return res.status(403).json({ message: 'Tidak diizinkan mengubah subtask ini' });

  if (manage) {
    if (req.body.judul     !== undefined) sub.judul     = req.body.judul;
    if (req.body.urutan    !== undefined) sub.urutan    = req.body.urutan;
    if (req.body.assignees !== undefined) sub.assignees = req.body.assignees || [];
    if (req.body.dueDate   !== undefined) sub.dueDate   = req.body.dueDate || null;
    if (req.body.priority  !== undefined) sub.priority  = req.body.priority;
  }
  if (req.body.isDone !== undefined) sub.isDone = req.body.isDone;

  await sub.save();
  await sub.populate('assignees', 'namaLengkap fotoProfil');
  res.json(sub);
});

// DELETE /api/subtasks/:id — creator saja, hapus juga turunannya
router.delete('/:id', auth, async (req, res) => {
  const sub = await Subtask.findById(req.params.id);
  if (!sub) return res.status(404).json({ message: 'Subtask tidak ditemukan' });

  const task = await Task.findById(sub.taskId);
  if (!task || !canManage(req.user, task))
    return res.status(403).json({ message: 'Hanya pembuat task yang dapat menghapus subtask' });

  // Hapus rekursif semua turunan
  await deleteDescendants(sub._id);
  await sub.deleteOne();
  res.json({ message: 'Subtask dihapus' });
});

async function deleteDescendants(parentId) {
  const children = await Subtask.find({ parentId });
  for (const c of children) {
    await deleteDescendants(c._id);
    await c.deleteOne();
  }
}

module.exports = router;
