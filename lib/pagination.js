function parsePagination(query, defaults = {}) {
  const page = Math.max(1, parseInt(query.page, 10) || defaults.page || 1);
  const limit = Math.min(200, Math.max(1, parseInt(query.limit, 10) || defaults.limit || 50));
  const skip = (page - 1) * limit;
  return { page, limit, skip };
}

function paginatedResponse(items, total, page, limit) {
  return {
    items,
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit) || 1,
    },
  };
}

module.exports = { parsePagination, paginatedResponse };
