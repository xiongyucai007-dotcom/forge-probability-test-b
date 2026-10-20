(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.VaultCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const APP = 'seedance-prompt-vault';
  const MAX_BACKUP_BYTES = 60 * 1024 * 1024;
  const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
  const FIELD_LIMITS = Object.freeze({ title: 160, prompt: 100000, negative: 50000, model: 200, parameters: 20000, category: 80, review: 20000, source: 2000, videoUrl: 4000 });
  const RECORD_KEYS = ['id', 'title', 'prompt', 'negative', 'model', 'parameters', 'category', 'tags', 'rating', 'review', 'source', 'videoUrl', 'images', 'favorite', 'createdAt', 'updatedAt', 'deletedAt'];
  const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

  function fail(message) { throw new Error(message); }
  function isPlain(value) { return value !== null && typeof value === 'object' && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null); }
  function text(value, field, limit, required) {
    if (typeof value !== 'string') fail(field + '必须是文本');
    if (value.length > limit) fail(field + '过长，最多 ' + limit + ' 个字符');
    if (required && !value.trim()) fail(field + '不能为空');
    if (value.includes('\u0000')) fail(field + '包含无效字符');
    return value;
  }
  function id(value, field) {
    if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,120}$/.test(value)) fail((field || '记录 ID') + '格式无效');
    return value;
  }
  function date(value, field) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) || Number.isNaN(Date.parse(value)) || new Date(value).toISOString() !== value) fail(field + '日期格式无效');
    return value;
  }
  function newId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    return 'p_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  }
  function safeUrl(value) {
    if (typeof value !== 'string' || !value.trim() || /[\u0000-\u0020\u007f]/.test(value)) return null;
    try {
      const url = new URL(value);
      return (url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password ? url.href : null;
    } catch (_) { return null; }
  }
  function rejectUnknown(object, allowed, field) {
    for (const key of Object.keys(object)) if (!allowed.includes(key)) fail(field + '包含未知字段：' + key);
  }
  function validateImage(image) {
    if (!isPlain(image)) fail('参考图格式无效');
    rejectUnknown(image, ['id', 'name', 'type', 'dataUrl'], '参考图');
    const imageId = id(image.id, '参考图 ID');
    const name = text(image.name, '参考图名称', 300, true);
    if (!IMAGE_TYPES.includes(image.type)) fail('参考图仅支持 PNG、JPEG、WebP 或 GIF');
    if (typeof image.dataUrl !== 'string') fail('参考图数据无效');
    const prefix = 'data:' + image.type + ';base64,';
    if (!image.dataUrl.startsWith(prefix)) fail('参考图数据类型不一致');
    const base64 = image.dataUrl.slice(prefix.length);
    if (!base64.length || base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64) || /=/.test(base64.slice(0, -2))) fail('参考图不是有效的 Base64 数据');
    const bytes = base64.length * 3 / 4 - (base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0);
    if (bytes > MAX_IMAGE_BYTES) fail('单张参考图不能超过 6 MB');
    return { id: imageId, name, type: image.type, dataUrl: image.dataUrl };
  }
  function validateRecord(input) {
    if (!isPlain(input)) fail('提示词记录格式无效');
    rejectUnknown(input, RECORD_KEYS, '提示词记录');
    for (const key of RECORD_KEYS) if (!Object.prototype.hasOwnProperty.call(input, key)) fail('提示词记录缺少字段：' + key);
    const strings = {};
    for (const [key, limit] of Object.entries(FIELD_LIMITS)) strings[key] = text(input[key], key, limit, key === 'title' || key === 'prompt');
    if (!Array.isArray(input.tags) || input.tags.length > 30) fail('标签必须是数组，最多 30 个');
    const tags = input.tags.map(tag => text(tag, '标签', 60, true).trim());
    if (new Set(tags.map(tag => tag.toLocaleLowerCase())).size !== tags.length) fail('标签不能重复');
    if (!Number.isInteger(input.rating) || input.rating < 0 || input.rating > 5) fail('效果评分必须是 0 到 5 的整数');
    if (typeof input.favorite !== 'boolean') fail('收藏状态无效');
    if (!Array.isArray(input.images) || input.images.length > 6) fail('参考图最多 6 张');
    const images = input.images.map(validateImage);
    if (new Set(images.map(image => image.id)).size !== images.length) fail('参考图 ID 重复');
    if (strings.videoUrl && !safeUrl(strings.videoUrl)) fail('成片链接仅支持有效的 http:// 或 https:// 地址');
    const createdAt = date(input.createdAt, '创建时间');
    const updatedAt = date(input.updatedAt, '更新时间');
    const deletedAt = input.deletedAt === null ? null : date(input.deletedAt, '删除时间');
    return {
      id: id(input.id), title: strings.title, prompt: strings.prompt, negative: strings.negative,
      model: strings.model, parameters: strings.parameters, category: strings.category, tags,
      rating: input.rating, review: strings.review, source: strings.source, videoUrl: strings.videoUrl,
      images, favorite: input.favorite, createdAt, updatedAt, deletedAt
    };
  }
  function makeRecord(input, existing) {
    if (!isPlain(input)) fail('提示词内容无效');
    if (existing) existing = validateRecord(existing);
    const now = new Date().toISOString();
    const value = Object.assign({ title: '', prompt: '', negative: '', model: '', parameters: '', category: '', tags: [], rating: 0, review: '', source: '', videoUrl: '', images: [], favorite: false, deletedAt: null }, existing || {}, input);
    value.id = existing ? existing.id : (input.id || newId());
    value.createdAt = existing ? existing.createdAt : (input.createdAt || now);
    value.updatedAt = now;
    if (typeof value.tags === 'string') value.tags = value.tags.split(/[,，、\n]/).map(tag => tag.trim()).filter(Boolean);
    if (Array.isArray(value.tags)) value.tags = Array.from(new Map(value.tags.map(tag => [String(tag).trim().toLocaleLowerCase(), String(tag).trim()])).values()).filter(Boolean);
    return validateRecord(value);
  }
  function utf8Bytes(value) {
    return typeof TextEncoder === 'function' ? new TextEncoder().encode(value).length : unescape(encodeURIComponent(value)).length;
  }
  function validateBackup(parsed) {
    if (!isPlain(parsed)) fail('备份必须是 JSON 对象');
    rejectUnknown(parsed, ['app', 'schema', 'exportedAt', 'records'], '备份');
    if (parsed.app !== APP || parsed.schema !== 1) fail('不支持此备份格式，请选择本应用导出的 schema 1 JSON');
    date(parsed.exportedAt, '导出时间');
    if (!Array.isArray(parsed.records) || parsed.records.length > 10000) fail('备份记录必须是数组，最多 10000 条');
    if (utf8Bytes(JSON.stringify(parsed)) > MAX_BACKUP_BYTES) fail('备份文件不能超过 60 MB');
    return parsed.records.map((record, index) => {
      try { return validateRecord(record); }
      catch (error) { fail('第 ' + (index + 1) + ' 条记录：' + error.message); }
    });
  }
  function makeBackup(records) {
    if (!Array.isArray(records)) fail('记录必须是数组');
    const backup = { app: APP, schema: 1, exportedAt: new Date().toISOString(), records: records.map(validateRecord) };
    validateBackup(backup);
    return backup;
  }
  function makeBackupParts(records, maxBytes = MAX_BACKUP_BYTES) {
    if (!Array.isArray(records)) fail('记录必须是数组');
    if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) fail('分卷大小必须是正整数');
    const budget = Math.min(maxBytes, MAX_BACKUP_BYTES);
    const exportedAt = new Date().toISOString();
    const envelope = { app: APP, schema: 1, exportedAt, records: [] };
    const emptyBytes = utf8Bytes(JSON.stringify(envelope));
    if (emptyBytes > budget) fail('分卷上限过小，无法容纳备份格式信息');
    const parts = [];
    let group = [];
    let groupBytes = emptyBytes;
    for (const input of records) {
      const record = validateRecord(input);
      const recordBytes = utf8Bytes(JSON.stringify(record));
      if (emptyBytes + recordBytes > budget) fail('单条记录「' + record.title + '」超过分卷上限，请减少该记录的参考图大小后再备份');
      const extra = recordBytes + (group.length ? 1 : 0);
      if (group.length >= 10000 || groupBytes + extra > budget) {
        parts.push({ app: APP, schema: 1, exportedAt, records: group });
        group = [];
        groupBytes = emptyBytes;
      }
      groupBytes += recordBytes + (group.length ? 1 : 0);
      group.push(record);
    }
    if (group.length || !parts.length) parts.push({ app: APP, schema: 1, exportedAt, records: group });
    return parts;
  }
  function searchableText(record) {
    return [record.title, record.prompt, record.negative, record.model, record.parameters, record.category, ...(record.tags || []), record.review, record.source, record.videoUrl, ...(record.images || []).map(image => image.name)].join('\n').toLocaleLowerCase();
  }
  function filterRecords(records, options) {
    const opts = options || {};
    const tokens = String(opts.query || '').normalize('NFKC').toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
    const result = records.filter(record => {
      if (Boolean(record.deletedAt) !== Boolean(opts.trash)) return false;
      if (opts.favorites && !record.favorite) return false;
      if (opts.category && opts.category !== 'all' && record.category !== opts.category) return false;
      if (opts.tag && opts.tag !== 'all' && !record.tags.includes(opts.tag)) return false;
      const haystack = searchableText(record).normalize('NFKC');
      return tokens.every(token => haystack.includes(token));
    });
    const sort = opts.sort || 'updated';
    result.sort((a, b) => sort === 'title' ? a.title.localeCompare(b.title, 'zh-CN') : sort === 'oldest' ? a.createdAt.localeCompare(b.createdAt) : sort === 'rating' ? b.rating - a.rating || b.updatedAt.localeCompare(a.updatedAt) : sort === 'newest' ? b.createdAt.localeCompare(a.createdAt) : b.updatedAt.localeCompare(a.updatedAt));
    return result;
  }
  function prepareImport(existingRecords, incomingRecords) {
    if (!Array.isArray(existingRecords) || !Array.isArray(incomingRecords)) fail('导入记录必须是数组');
    const existing = existingRecords.map(validateRecord);
    const incoming = incomingRecords.map(validateRecord);
    const byId = new Map(existing.map(record => [record.id, record]));
    const records = [];
    let skipped = 0;
    let conflicts = 0;
    for (const source of incoming) {
      let record = source;
      const current = byId.get(record.id);
      if (current && JSON.stringify(current) === JSON.stringify(record)) { skipped++; continue; }
      if (current) {
        conflicts++;
        let nextId;
        do { nextId = newId(); } while (byId.has(nextId));
        record = Object.assign({}, record, { id: nextId });
      }
      byId.set(record.id, record);
      records.push(record);
    }
    return { records, added: records.length, skipped, conflicts };
  }
  return Object.freeze({ APP, MAX_BACKUP_BYTES, MAX_IMAGE_BYTES, FIELD_LIMITS, IMAGE_TYPES, newId, safeUrl, validateRecord, validateBackup, makeRecord, makeBackup, makeBackupParts, searchableText, filterRecords, prepareImport });
});
