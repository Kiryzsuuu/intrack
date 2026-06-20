const Task        = require('../models/Task');
const KpiSnapshot = require('../models/KpiSnapshot');

function hitungGrade(skor) {
  if (skor >= 85) return 'A';
  if (skor >= 70) return 'B';
  if (skor >= 50) return 'C';
  return 'D';
}

function labelGrade(grade) {
  const map = { A: 'Excellent', B: 'Good', C: 'Average', D: 'Needs Improvement' };
  return map[grade] || '-';
}

async function hitungKpiManager(userId, bulan, tahun) {
  const awalPeriode = new Date(tahun, bulan - 1, 1);
  const akhirPeriode = new Date(tahun, bulan, 0, 23, 59, 59);

  // Task yang di-assign ke user ini dalam periode
  const tasks = await Task.find({
    assignees: userId,
    isDeleted: false,
    // task dipertimbangkan jika dibuat dalam periode atau deadline dalam periode
    $or: [
      { createdAt: { $gte: awalPeriode, $lte: akhirPeriode } },
      { doneAt:    { $gte: awalPeriode, $lte: akhirPeriode } },
    ],
  });

  const totalAssigned = tasks.length;
  const doneTasks     = tasks.filter(t => t.status === 'complete');
  const totalDone     = doneTasks.length;

  // Ketepatan waktu: done sebelum/tepat deadline
  const totalTepat = doneTasks.filter(t => {
    if (!t.doneAt || !t.deadline) return false;
    return new Date(t.doneAt) <= new Date(t.deadline);
  }).length;

  // Total siklus revisi pada task yang done
  const totalRevisi = doneTasks.reduce((acc, t) => acc + (t.revisiCount || 0), 0);

  // Formula
  const skorWaktu   = totalDone > 0 ? (totalTepat / totalDone) * 100 : 0;
  const skorVolume  = totalAssigned > 0 ? (totalDone / totalAssigned) * 100 : 0;
  const skorKualitas = totalDone > 0
    ? (totalDone / (totalDone + totalRevisi)) * 100
    : 0;

  const skorTotal = (skorWaktu * 0.40) + (skorVolume * 0.35) + (skorKualitas * 0.25);

  return {
    skorTotal: Math.round(skorTotal * 10) / 10,
    skorWaktu: Math.round(skorWaktu * 10) / 10,
    skorVolume: Math.round(skorVolume * 10) / 10,
    skorKualitas: Math.round(skorKualitas * 10) / 10,
    totalDone,
    totalAssigned,
    totalTepat,
    totalRevisi,
    grade: hitungGrade(skorTotal),
    label: labelGrade(hitungGrade(skorTotal)),
  };
}

async function simpanSnapshot(userId, bulan, tahun, targetKpi = 70) {
  const kpi = await hitungKpiManager(userId, bulan, tahun);

  // Bulan pertama setelah app live = kalibrasi
  const isKalibrasi = bulan === new Date().getMonth() + 1 && tahun === new Date().getFullYear();

  const snap = await KpiSnapshot.findOneAndUpdate(
    { userId, periodeBulan: bulan, periodeTahun: tahun },
    {
      ...kpi,
      targetKpi,
      isKalibrasi,
    },
    { upsert: true, new: true }
  );

  return snap;
}

module.exports = { hitungKpiManager, simpanSnapshot, hitungGrade, labelGrade };
