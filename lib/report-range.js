function parseIntSafe(val, fallback) {
  const n = parseInt(val, 10);
  return Number.isFinite(n) ? n : fallback;
}

/** Resolve report period from query: year, month, from, to */
function parseReportRange(query = {}) {
  const { from, to, year, month } = query;
  const now = new Date();

  if (from && to) {
    const start = new Date(from);
    const end = new Date(to);
    end.setHours(23, 59, 59, 999);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      throw new Error('Invalid from/to dates');
    }
    return {
      start,
      end,
      mode: 'custom',
      label: `${formatDateLabel(start)} – ${formatDateLabel(end)}`,
    };
  }

  if (year && month) {
    const y = parseIntSafe(year, now.getFullYear());
    const m = parseIntSafe(month, now.getMonth() + 1) - 1;
    const start = new Date(y, m, 1);
    const end = new Date(y, m + 1, 0, 23, 59, 59, 999);
    return {
      start,
      end,
      mode: 'month',
      year: y,
      month: m + 1,
      label: start.toLocaleString('en-US', { month: 'long', year: 'numeric' }),
    };
  }

  if (year) {
    const y = parseIntSafe(year, now.getFullYear());
    const start = new Date(y, 0, 1);
    const end = new Date(y, 11, 31, 23, 59, 59, 999);
    return {
      start,
      end,
      mode: 'year',
      year: y,
      label: String(y),
    };
  }

  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
  return {
    start,
    end,
    mode: 'month',
    year: now.getFullYear(),
    month: now.getMonth() + 1,
    label: start.toLocaleString('en-US', { month: 'long', year: 'numeric' }),
  };
}

function formatDateLabel(d) {
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function dateMatchFilter(start, end) {
  return { createdAt: { $gte: start, $lte: end } };
}

function dateFieldMatchFilter(field, start, end) {
  return { [field]: { $gte: start, $lte: end } };
}

function timelineBucketKey(date, granularity) {
  const d = new Date(date);
  if (granularity === 'month') {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }
  if (granularity === 'day') {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  return String(d.getFullYear());
}

function timelineBucketLabel(key, granularity) {
  if (granularity === 'month') {
    const [y, m] = key.split('-').map(Number);
    return new Date(y, m - 1, 1).toLocaleString('en-US', { month: 'short' });
  }
  if (granularity === 'day') {
    const parts = key.split('-').map(Number);
    return String(parts[2]);
  }
  return key;
}

function pickTimelineGranularity(range) {
  const days = Math.ceil((range.end - range.start) / (24 * 60 * 60 * 1000)) + 1;
  if (range.mode === 'year') return 'month';
  if (range.mode === 'month') return 'day';
  if (days <= 45) return 'day';
  if (days <= 366) return 'month';
  return 'year';
}

function buildTimelineBuckets(range, granularity) {
  const buckets = [];
  if (granularity === 'month') {
    const y = range.mode === 'year' ? range.year : range.start.getFullYear();
    for (let m = 0; m < 12; m += 1) {
      const key = `${y}-${String(m + 1).padStart(2, '0')}`;
      buckets.push({ key, label: new Date(y, m, 1).toLocaleString('en-US', { month: 'short' }) });
    }
    return buckets;
  }
  if (granularity === 'day') {
    const cur = new Date(range.start);
    cur.setHours(0, 0, 0, 0);
    const end = new Date(range.end);
    end.setHours(0, 0, 0, 0);
    while (cur <= end) {
      const key = timelineBucketKey(cur, 'day');
      buckets.push({ key, label: String(cur.getDate()) });
      cur.setDate(cur.getDate() + 1);
    }
    return buckets;
  }
  const y0 = range.start.getFullYear();
  const y1 = range.end.getFullYear();
  for (let y = y0; y <= y1; y += 1) {
    buckets.push({ key: String(y), label: String(y) });
  }
  return buckets;
}

module.exports = {
  parseReportRange,
  dateMatchFilter,
  dateFieldMatchFilter,
  timelineBucketKey,
  timelineBucketLabel,
  pickTimelineGranularity,
  buildTimelineBuckets,
  formatDateLabel,
};
