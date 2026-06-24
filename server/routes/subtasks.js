const router  = require('express').Router();
const Subtask = require('../models/Subtask');
const Task    = require('../models/Task');
const auth    = require('../middleware/auth');

function idStr(v) { return v?._id?.toString() || v?.toString() || ''; }
function isCreator(user, task) {
  if (idStr(task.dibuatOleh) === user._id.toString()) return true;
  return (task.creators || []).map(idStr).includes(user._id.toString());
}
function isDireksi(user) { return ['direksi', 'superadmin'].includes(user.role); }
function canManage(user, task) { return isDireksi(user) || isCreator(user, task); }
function isSubAssignee(user, sub) {
  return (sub.assignees || []).map(idStr).includes(user._id.toString());
}

// Hitung ulang status task dari progres subtask (tanpa require circular ke tasks.js)
async function recomputeTaskStatus(taskId) {
  const task = await Task.findById(taskId);
  if (!task || task.status === 'complete') return;
  const subs = await Subtask.find({ taskId });
  if (!subs.length) return;
  const total = subs.length;
  const done  = subs.filter(s => s.status === 'done' || s.isDone).length;
  const prog  = subs.filter(s => s.status === 'on_progress').length;
  if (done >= total)        { task.status = 'partially_complete'; task.pendingApproval = true; }
  else if (done > 0 || prog) { task.status = 'on_progress';        task.pendingApproval = false; }
  else                       { task.status = 'to_do';              task.pendingApproval = false; }
  await task.save();
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

  const manage   = canManage(req.user, task);
  const assignee = isSubAssignee(req.user, sub);
  const isSuper  = req.user.role === 'superadmin';

  // Perubahan status/isDone HANYA oleh assignee subtask (req #4) atau superadmin
  const wantsStatusChange = req.body.status !== undefined || req.body.isDone !== undefined;
  if (wantsStatusChange && !assignee && !isSuper)
    return res.status(403).json({ message: 'Subtask hanya bisa diselesaikan oleh user yang di-assign' });

  // Perubahan field lain (judul/assignee/dll) hanya oleh pengelola task
  const wantsManageChange = ['judul','urutan','assignees','dueDate','priority'].some(k => req.body[k] !== undefined);
  if (wantsManageChange && !manage)
    return res.status(403).json({ message: 'Hanya pembuat task yang dapat mengubah detail subtask' });

  if (manage) {
    if (req.body.judul     !== undefined) sub.judul     = req.body.judul;
    if (req.body.urutan    !== undefined) sub.urutan    = req.body.urutan;
    if (req.body.assignees !== undefined) sub.assignees = req.body.assignees || [];
    if (req.body.dueDate   !== undefined) sub.dueDate   = req.body.dueDate || null;
    if (req.body.priority  !== undefined) sub.priority  = req.body.priority;
  }

  // Status subtask: terima `status` (to_do/on_progress/done) atau `isDone` (legacy)
  if (req.body.status !== undefined && ['to_do','on_progress','done'].includes(req.body.status)) {
    sub.status = req.body.status;
    sub.isDone = req.body.status === 'done';
  } else if (req.body.isDone !== undefined) {
    sub.isDone = !!req.body.isDone;
    sub.status = req.body.isDone ? 'done' : 'to_do';
  }

  await sub.save();
  await sub.populate('assignees', 'namaLengkap fotoProfil');

  if (wantsStatusChange) await recomputeTaskStatus(sub.taskId).catch(() => {});
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
