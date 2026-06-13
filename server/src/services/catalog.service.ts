import { pool } from '../db/pool';
import { debugLog } from '../utils/debug-log';

export type CatalogStatus = 'disponible' | 'sous_offre' | 'vendu' | 'retire';
export type CatalogTransaction = 'vente' | 'location';
export type CatalogType = 'maison' | 'appartement' | 'terrain' | 'autre';

export type CatalogProperty = {
  tenant_id: string;
  id_unique: string;

  type: CatalogType | null;
  transaction: CatalogTransaction | null;
  statut: CatalogStatus;

  url_annonce: string | null;
  date_maj: string;

  prix: number | null;
  charges: number | null;
  tax_year: number | null;

  surface_m2: number | null;
  pieces: number | null;
  chambres: number | null;
  floor: number | null;
  elevator: boolean | null;

  ville: string | null;
  code_postal: string | null;
  country: string | null;
  lat: number | null;
  lon: number | null;

  flags: Record<string, boolean | null>;

  title: string | null;
  description: string | null;
  tags: string[];
  photos_urls: string[];
};

function parseBudgetRange(query: string): { min?: number; max?: number } {
  const q = query.toLowerCase();

  const between = q.match(/entre\s+([0-9\s]+)\s*(k|m|€|eur)?\s+et\s+([0-9\s]+)\s*(k|m|€|eur)?/i);
  if (between) {
    const a = normalizeMoney(between[1], between[2]);
    const b = normalizeMoney(between[3], between[4]);
    const min = a != null && b != null ? Math.min(a, b) : undefined;
    const max = a != null && b != null ? Math.max(a, b) : undefined;
    return { min, max };
  }

  const under = q.match(/(max|maximum|moins de|inf(é|e)rieur (à|a))\s+([0-9\s]+)\s*(k|m|€|eur)?/i);
  if (under) {
    const max = normalizeMoney(under[4], under[5]);
    return { max: max ?? undefined };
  }

  const over = q.match(/(min|minimum|plus de|sup(é|e)rieur (à|a))\s+([0-9\s]+)\s*(k|m|€|eur)?/i);
  if (over) {
    const min = normalizeMoney(over[4], over[5]);
    return { min: min ?? undefined };
  }

  return {};
}

function normalizeMoney(numPart: string, suffix: string | undefined): number | null {
  const raw = numPart.replace(/\s+/g, '');
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  const s = (suffix || '').toLowerCase();
  if (s === 'k') return Math.round(n * 1000);
  if (s === 'm') return Math.round(n * 1000000);
  return Math.round(n);
}

function parseRooms(query: string): number | undefined {
  const q = query.toLowerCase();
  const t = q.match(/\bt\s*([1-9])\b/i);
  if (t) return Number(t[1]);
  const pieces = q.match(/\b([1-9])\s*(pi(è|e)ces?|p)\b/i);
  if (pieces) return Number(pieces[1]);
  return undefined;
}

function parseSurfaceRange(query: string): { min?: number; max?: number } {
  const q = normalizeLooseText(query);
  const unit = '(?:m2|m²|metres?\s+carres?|mètres?\s+carr(é|e)s?)';

  const between = q.match(new RegExp(`\\bentre\\s+([0-9]{1,4})\\s*${unit}?\\s+et\\s+([0-9]{1,4})\\s*${unit}\\b`, 'i'));
  if (between) {
    const a = Number(between[1]);
    const b = Number(between[2]);
    if (Number.isFinite(a) && Number.isFinite(b)) {
      return { min: Math.min(a, b), max: Math.max(a, b) };
    }
  }

  const under = q.match(new RegExp(`\\b(max|maximum|moins\s+de|inf(é|e)rieur\s+(à|a))\\s+([0-9]{1,4})\\s*${unit}\\b`, 'i'));
  if (under) {
    const max = Number(under[4]);
    return { max: Number.isFinite(max) ? max : undefined };
  }

  const over = q.match(new RegExp(`\\b(min|minimum|plus\s+de|sup(é|e)rieur\s+(à|a))\\s+([0-9]{1,4})\\s*${unit}\\b`, 'i'));
  if (over) {
    const min = Number(over[4]);
    return { min: Number.isFinite(min) ? min : undefined };
  }

  const simple = q.match(new RegExp(`\\b([0-9]{1,4})\\s*${unit}\\b`, 'i'));
  if (simple) {
    const n = Number(simple[1]);
    if (Number.isFinite(n)) return { min: n };
  }

  return {};
}

function normalizeLooseText(input: string): string {
  return input
    .toLowerCase()
    .replace(/[’']/g, ' ')
    .replace(/[-_/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractCityCandidate(query: string): string | undefined {
  const q = normalizeLooseText(query);

  const bannedStarts = [
    'centre commercial',
    'centre ville',
    'centre',
    'commercial',
  ];

  const cleanCandidate = (raw: string): string => {
    let city = raw.trim();
    city = city.replace(/\b(pr(e|è)s|proche|autour|autour de|vers)\b[\s\S]*$/i, '').trim();
    city = city.replace(/\b(pour|avec|sans|et|budget|prix|surface|m2|m²|metres|mètres|pieces|pi(è|e)ces|chambres?)\b[\s\S]*$/i, '').trim();
    city = city.replace(/\b(appartement|maison|terrain|studio|achat|acheter|vente|vendre|location|louer|t\s*[1-9]|pi(è|e)ce(s)?|chambre(s)?)\b/gi, ' ');
    city = city.replace(/\b\d{1,6}\b/g, ' ');
    city = city.replace(/\s+/g, ' ').trim();

    const cityNoArticle = city.replace(/^(le|la|les|l)\s+/i, '').trim();
    for (const b of bannedStarts) {
      if (city === b || city.startsWith(`${b} `)) return '';
      if (cityNoArticle === b || cityNoArticle.startsWith(`${b} `)) return '';
    }
    return city;
  };

  const matches = Array.from(q.matchAll(/\b(?:a|à|au|aux|sur|dans|vers|en)\s+([a-z0-9\s]{3,60})/gi));
  const candidates = matches
    .map((m) => cleanCandidate(m[1] || ''))
    .filter((c) => c && c.length >= 3);

  if (candidates.length === 0) return undefined;

  const best = [...candidates].sort((a, b) => {
    const aw = a.split(' ').filter(Boolean).length;
    const bw = b.split(' ').filter(Boolean).length;
    if (bw !== aw) return bw - aw;
    return b.length - a.length;
  })[0];

  return best || undefined;
}

function parseCityOrPostcode(query: string): { ville?: string; code_postal?: string } {
  const q = query.trim();
  const cp = q.match(/\b(\d{5})\b/);
  if (cp) return { code_postal: cp[1] };
  const ville = extractCityCandidate(q);
  return ville ? { ville } : {};
}

function extractFtsTokens(query: string): string[] {
  const stop = new Set([
    'a', 'à', 'au', 'aux', 'de', 'des', 'du', 'd', 'la', 'le', 'les', 'un', 'une', 'et', 'en', 'sur', 'dans', 'vers',
    'je', 'tu', 'il', 'elle', 'on', 'nous', 'vous', 'ils', 'elles', 'mon', 'ma', 'mes', 'ton', 'ta', 'tes', 'son', 'sa', 'ses',
    'bonjour', 'salut', 'hey', 'hello', 'coucou', 'svp', 'stp', 'merci',
    'avez', 'aviez', 'auriez', 'pouvez', 'pourriez', 'voudrais', 'veux', 'cherche', 'recherche', 'voir', 'avoir',
    'des', 'du', 'dun', 'une', 'que', 'qui', 'quoi', 'est', 'etes', 'être', 'etre',
  ]);

  const normalized = normalizeLooseText(query);
  const rawTokens = normalized.split(' ').filter(Boolean);

  const tokens: string[] = [];
  for (const t of rawTokens) {
    const clean = t.replace(/[^a-z0-9]/g, '').trim();
    if (!clean) continue;
    if (stop.has(clean)) continue;
    if (clean.length < 2 && !/\d/.test(clean)) continue;
    tokens.push(clean);
  }

  const uniq = Array.from(new Set(tokens));
  return uniq.slice(0, 12);
}

function extractReference(query: string): string | undefined {
  const m = query.match(/\bref\s*(\d{3,10})\b/i) || query.match(/\bref(\d{3,10})\b/i);
  if (!m) return undefined;
  return `REF${m[1]}`.toUpperCase();
}

function extractReferences(query: string): string[] {
  const refs: string[] = [];

  for (const m of query.matchAll(/\bref\s*(\d{3,10})\b/gi)) {
    refs.push(`REF${m[1]}`.toUpperCase());
  }
  for (const m of query.matchAll(/\bref(\d{3,10})\b/gi)) {
    refs.push(`REF${m[1]}`.toUpperCase());
  }
  for (const m of query.matchAll(/\bREF\d{3,10}\b/g)) {
    refs.push(m[0].toUpperCase());
  }

  return Array.from(new Set(refs.map((r) => normalizeIdUnique(r))));
}

function normalizeIdUnique(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]+/g, '');
}

export class CatalogService {
  static async searchForContext(params: {
    tenantId: string;
    query: string;
    limit?: number;
    requestId?: string;
  }): Promise<CatalogProperty[]> {
    const limit = Math.max(1, Math.min(10, params.limit ?? 3));

    debugLog('catalog.search.start', {
      requestId: params.requestId,
      tenantId: params.tenantId,
      query: params.query,
      limit,
    });

    const refs = extractReferences(params.query);
    if (refs.length > 0) {
      debugLog('catalog.search.mode', { requestId: params.requestId, mode: 'reference', ref: refs[0], refs });

      const normalizedRefs = refs.map((r) => normalizeIdUnique(r));
      const placeholders = normalizedRefs.map((_, i) => `$${i + 2}`).join(', ');
      const values: any[] = [params.tenantId, ...normalizedRefs];

      const sql = `
        SELECT
          tenant_id,
          id_unique,
          type,
          transaction,
          statut,
          url_annonce,
          date_maj,
          prix,
          charges,
          tax_year,
          surface_m2,
          pieces,
          chambres,
          floor,
          elevator,
          ville,
          code_postal,
          country,
          lat,
          lon,
          flags,
          title,
          description,
          tags,
          photos_urls
        FROM catalog_properties
        WHERE tenant_id = $1
          AND statut IN ('disponible','sous_offre')
          AND upper(regexp_replace(coalesce(id_unique,''), '[^A-Za-z0-9]+', '', 'g')) IN (${placeholders})
        ORDER BY date_maj DESC NULLS LAST
        LIMIT ${limit}
      `;

      const res = await pool.query(sql, values);
      if (res.rows.length > 0) {
        debugLog('catalog.search.result', {
          requestId: params.requestId,
          rows: res.rows.length,
          ids: res.rows.map((r) => r.id_unique).slice(0, 10),
        });
        return res.rows.map((r) => ({
          tenant_id: r.tenant_id,
          id_unique: r.id_unique,
          type: r.type,
          transaction: r.transaction,
          statut: r.statut,
          url_annonce: r.url_annonce,
          date_maj: r.date_maj instanceof Date ? r.date_maj.toISOString() : String(r.date_maj),
          prix: r.prix,
          charges: r.charges,
          tax_year: r.tax_year,
          surface_m2: r.surface_m2,
          pieces: r.pieces,
          chambres: r.chambres,
          floor: r.floor,
          elevator: r.elevator,
          ville: r.ville,
          code_postal: r.code_postal,
          country: r.country,
          lat: r.lat,
          lon: r.lon,
          flags: r.flags || {},
          title: r.title,
          description: r.description,
          tags: Array.isArray(r.tags) ? r.tags : [],
          photos_urls: Array.isArray(r.photos_urls) ? r.photos_urls : [],
        }));
      }
    }

    const budget = parseBudgetRange(params.query);
    const surface = parseSurfaceRange(params.query);
    const rooms = parseRooms(params.query);
    const loc = parseCityOrPostcode(params.query);

    debugLog('catalog.search.filters', {
      requestId: params.requestId,
      budget,
      surface,
      rooms,
      loc,
    });

    const where: string[] = [
      `tenant_id = $1`,
      `statut IN ('disponible','sous_offre')`,
    ];

    const values: any[] = [params.tenantId];
    let idx = values.length + 1;

    if (budget.min != null) {
      where.push(`prix >= $${idx++}`);
      values.push(budget.min);
    }
    if (budget.max != null) {
      where.push(`prix <= $${idx++}`);
      values.push(budget.max);
    }
    if (surface.min != null) {
      where.push(`surface_m2 >= $${idx++}`);
      values.push(surface.min);
    }
    if (surface.max != null) {
      where.push(`surface_m2 <= $${idx++}`);
      values.push(surface.max);
    }
    if (rooms != null) {
      where.push(`pieces = $${idx++}`);
      values.push(rooms);
    }
    if (loc.code_postal) {
      where.push(`code_postal = $${idx++}`);
      values.push(loc.code_postal);
    }

    if (loc.ville) {
      where.push(
        `regexp_replace(lower(coalesce(ville,'')), '[^a-z0-9]+', ' ', 'g') LIKE '%' || $${idx++} || '%'`
      );
      values.push(normalizeLooseText(loc.ville).replace(/[^a-z0-9 ]+/g, ' ').trim());
    }

    const q = params.query.trim();
    if (q) {
      const tokens = extractFtsTokens(q);
      if (tokens.length > 0) {
        where.push(`search_tsv @@ to_tsquery('simple', $${idx++})`);
        values.push(tokens.join(' | '));
      } else {
        where.push(`search_tsv @@ plainto_tsquery('simple', $${idx++})`);
        values.push(q);
      }
    }

    const sql = `
      SELECT
        tenant_id,
        id_unique,
        type,
        transaction,
        statut,
        url_annonce,
        date_maj,
        prix,
        charges,
        tax_year,
        surface_m2,
        pieces,
        chambres,
        floor,
        elevator,
        ville,
        code_postal,
        country,
        lat,
        lon,
        flags,
        title,
        description,
        tags,
        photos_urls
      FROM catalog_properties
      WHERE ${where.join(' AND ')}
      ORDER BY date_maj DESC NULLS LAST
      LIMIT ${limit}
    `;

    const res = await pool.query(sql, values);

    return res.rows.map((r) => ({
      tenant_id: r.tenant_id,
      id_unique: r.id_unique,
      type: r.type,
      transaction: r.transaction,
      statut: r.statut,
      url_annonce: r.url_annonce,
      date_maj: r.date_maj instanceof Date ? r.date_maj.toISOString() : String(r.date_maj),
      prix: r.prix,
      charges: r.charges,
      tax_year: r.tax_year,
      surface_m2: r.surface_m2,
      pieces: r.pieces,
      chambres: r.chambres,
      floor: r.floor,
      elevator: r.elevator,
      ville: r.ville,
      code_postal: r.code_postal,
      country: r.country,
      lat: r.lat,
      lon: r.lon,
      flags: r.flags || {},
      title: r.title,
      description: r.description,
      tags: Array.isArray(r.tags) ? r.tags : [],
      photos_urls: Array.isArray(r.photos_urls) ? r.photos_urls : [],
    }));
  }

  static formatPropertiesForContext(properties: CatalogProperty[]): string {
    if (properties.length === 0) return '';

    const header = `\n\nCATALOGUE INTERNE - ${properties.length} BIENS\n\n`;

    const lines = properties.map((p, i) => {
      const price = p.prix != null ? `${p.prix.toLocaleString('fr-FR')} €` : 'Prix NC';
      const surface = p.surface_m2 != null ? `${p.surface_m2}m²` : 'Surface NC';
      const rooms = p.pieces != null ? `${p.pieces}P` : '';
      const beds = p.chambres != null ? `${p.chambres}Ch` : '';
      const loc = [p.ville, p.code_postal].filter(Boolean).join(' ');
      const url = p.url_annonce ? ` | ${p.url_annonce}` : '';

      return `${i + 1}. Référence: ${p.id_unique} | ${p.type || 'bien'} | ${loc}\n   ${price} | ${surface} ${rooms}/${beds}${url}`.trim();
    }).join('\n\n');

    return header + lines + `\n\nRÈGLE: Données réelles du catalogue. Ne jamais inventer.`;
  }
}
