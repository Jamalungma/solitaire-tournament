const assert = require('assert');
const { formatDate, formatLevel, generateCSV, levelLabels } = require('./utils.js');

console.log('Запускаю тесты для utils.js...\n');

// Тест 1: formatDate с null
assert.strictEqual(formatDate(null), '—', 'formatDate(null) должна вернуть "—"');
console.log('✓ formatDate(null) = "—"');

// Тест 2: formatDate с ISO датой
const testDate = '2026-03-31T10:00:00Z';
const formatted = formatDate(testDate);
assert(formatted.includes('31'), 'Дата должна содержать день 31');
assert(formatted.includes('03'), 'Дата должна содержать месяц 03');
console.log(`✓ formatDate('${testDate}') = '${formatted}'`);

// Тест 3: formatLevel существующий уровень
assert.strictEqual(formatLevel('beginner'), 'Новичок', 'formatLevel("beginner") должна вернуть "Новичок"');
console.log('✓ formatLevel("beginner") = "Новичок"');

// Тест 4: formatLevel неизвестный уровень
assert.strictEqual(formatLevel('unknown'), 'unknown', 'formatLevel должна вернуть неизвестный уровень как есть');
console.log('✓ formatLevel("unknown") = "unknown"');

// Тест 5: formatLevel пустой уровень
assert.strictEqual(formatLevel(''), '', 'formatLevel("") должна вернуть ""');
console.log('✓ formatLevel("") = ""');

// Тест 6: generateCSV с пустым списком
assert.strictEqual(generateCSV([]), null, 'generateCSV([]) должна вернуть null');
console.log('✓ generateCSV([]) = null');

// Тест 7: generateCSV с одним участником
const csv = generateCSV([{
  name: 'Таир',
  email: 'tair@example.com',
  level: 'beginner',
  registered_at: '2026-03-31T10:00:00Z'
}]);

assert(csv.includes('Имя,Email,Уровень,Дата'), 'CSV должна содержать заголовки');
assert(csv.includes('Таир'), 'CSV должна содержать имя');
assert(csv.includes('tair@example.com'), 'CSV должна содержать email');
assert(csv.includes('Новичок'), 'CSV должна содержать уровень');
assert(csv.startsWith('\uFEFF'), 'CSV должна начинаться с BOM');
console.log('✓ generateCSV генерирует корректный CSV');

// Тест 8: generateCSV с кавычками в имени
const csvQuotes = generateCSV([{
  name: 'Иван "Гений" Петров',
  email: 'ivan@example.com',
  level: 'pro',
  registered_at: null
}]);

assert(csvQuotes.includes('Иван ""Гений"" Петров'), 'CSV должна экранировать кавычки');
assert(csvQuotes.includes('—'), 'CSV должна показать "—" для отсутствующей даты');
console.log('✓ generateCSV экранирует кавычки и обрабатывает отсутствующие даты');

// Тест 9: levelLabels содержит все ожидаемые уровни
assert(levelLabels.beginner, 'levelLabels должна содержать beginner');
assert(levelLabels.intermediate, 'levelLabels должна содержать intermediate');
assert(levelLabels.pro, 'levelLabels должна содержать pro');
console.log('✓ levelLabels содержит все уровни');

console.log('\n✅ Все 9 тестов прошли!');
