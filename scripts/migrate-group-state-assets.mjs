import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET = process.env.GROUP_ASSETS_BUCKET || 'group-assets';
const BATCH_SIZE = Number(process.env.BATCH_SIZE || 100);
const DRY_RUN = process.env.DRY_RUN === 'true';
const ORG_ID = process.env.ORG_ID || null;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const DATA_URL_PATTERN = /^data:([^;,]+);base64,(.+)$/s;

const extensionFromMimeType = mimeType => {
  const normalized = mimeType.toLowerCase();
  if (normalized.includes('png')) return 'png';
  if (normalized.includes('webp')) return 'webp';
  if (normalized.includes('gif')) return 'gif';
  if (normalized.includes('pdf')) return 'pdf';
  return normalized.includes('jpeg') || normalized.includes('jpg') ? 'jpg' : 'bin';
};

const sanitizePathPart = value =>
  String(value || 'asset')
    .replace(/[/\\]+/g, '-')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'asset';

const dataUrlToUpload = async ({ dataUrl, orgId, groupId, jsonPath, counter }) => {
  const match = dataUrl.match(DATA_URL_PATTERN);
  if (!match) return null;

  const mimeType = match[1] || 'application/octet-stream';
  const base64 = match[2] || '';
  const bytes = Buffer.from(base64, 'base64');
  if (bytes.length === 0) return null;

  const extension = extensionFromMimeType(mimeType);
  const fileName = `${Date.now()}-${counter}-${sanitizePathPart(jsonPath)}.${extension}`;
  const objectPath = `${orgId}/${groupId}/${fileName}`;

  if (!DRY_RUN) {
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(objectPath, bytes, {
        contentType: mimeType,
        upsert: false,
      });
    if (error) throw error;
  }

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(objectPath);
  return data.publicUrl;
};

const migrateJsonValue = async ({ value, orgId, groupId, path = [], stats }) => {
  if (typeof value === 'string') {
    if (!value.startsWith('data:image/') && !DATA_URL_PATTERN.test(value)) {
      return { changed: false, value };
    }

    stats.assets += 1;
    const publicUrl = await dataUrlToUpload({
      dataUrl: value,
      orgId,
      groupId,
      jsonPath: path.join('-') || 'asset',
      counter: stats.assets,
    });
    return publicUrl ? { changed: true, value: publicUrl } : { changed: false, value };
  }

  if (Array.isArray(value)) {
    let changed = false;
    const next = [];
    for (let index = 0; index < value.length; index += 1) {
      const result = await migrateJsonValue({
        value: value[index],
        orgId,
        groupId,
        path: [...path, String(index)],
        stats,
      });
      changed = changed || result.changed;
      next.push(result.value);
    }
    return { changed, value: changed ? next : value };
  }

  if (!value || typeof value !== 'object') {
    return { changed: false, value };
  }

  let changed = false;
  const next = {};
  for (const [key, entry] of Object.entries(value)) {
    const result = await migrateJsonValue({
      value: entry,
      orgId,
      groupId,
      path: [...path, key],
      stats,
    });
    changed = changed || result.changed;
    next[key] = result.value;
  }
  return { changed, value: changed ? next : value };
};

const loadRows = async offset => {
  let query = supabase
    .from('group_state')
    .select('org_id, group_id, data')
    .order('group_id', { ascending: true })
    .range(offset, offset + BATCH_SIZE - 1);

  if (ORG_ID) {
    query = query.eq('org_id', ORG_ID);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
};

let offset = 0;
let scannedRows = 0;
let changedRows = 0;
let uploadedAssets = 0;

while (true) {
  const rows = await loadRows(offset);
  if (rows.length === 0) break;

  for (const row of rows) {
    scannedRows += 1;
    const stats = { assets: 0 };
    const result = await migrateJsonValue({
      value: row.data || {},
      orgId: row.org_id,
      groupId: row.group_id,
      stats,
    });
    uploadedAssets += stats.assets;

    if (!result.changed) continue;
    changedRows += 1;

    if (!DRY_RUN) {
      const { error } = await supabase
        .from('group_state')
        .update({
          data: result.value,
          updated_at: new Date().toISOString(),
        })
        .eq('org_id', row.org_id)
        .eq('group_id', row.group_id);
      if (error) throw error;
    }

    console.log(`${DRY_RUN ? '[dry-run] ' : ''}migrated ${row.org_id}/${row.group_id}: ${stats.assets} asset(s)`);
  }

  offset += rows.length;
  if (rows.length < BATCH_SIZE) break;
}

console.log(
  `${DRY_RUN ? '[dry-run] ' : ''}done: scanned ${scannedRows} row(s), changed ${changedRows} row(s), uploaded ${uploadedAssets} asset(s)`
);
