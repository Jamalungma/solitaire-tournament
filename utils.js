// Полезные функции, которые можно тестировать

const levelLabels = {
  beginner: 'Новичок',
  intermediate: 'Средний',
  pro: 'Профи'
};

function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  });
}

function formatLevel(level) {
  return levelLabels[level] || level || '';
}

function generateCSV(participants) {
  if (participants.length === 0) {
    return null;
  }

  const header = ['Имя', 'Email', 'Уровень', 'Дата'];
  const rows = participants.map(p => [
    `"${(p.name || '').replace(/"/g, '""')}"`,
    `"${(p.email || '').replace(/"/g, '""')}"`,
    `"${formatLevel(p.level)}"`,
    `"${formatDate(p.registered_at)}"`
  ]);

  const csv = [header, ...rows].map(r => r.join(',')).join('\r\n');
  return '\uFEFF' + csv; // BOM для Excel
}

// Экспорт для Node.js тестов
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    formatDate,
    formatLevel,
    generateCSV,
    levelLabels
  };
}

// Глобальный экспорт для браузера (admin.html)
if (typeof window !== 'undefined') {
  window.formatDate = formatDate;
  window.formatLevel = formatLevel;
  window.generateCSV = generateCSV;
  window.levelLabels = levelLabels;
}
