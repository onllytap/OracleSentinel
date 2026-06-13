import { XMLParser } from 'fast-xml-parser';
import { pool } from '../db/pool';
import { CatalogProperty, CatalogStatus, CatalogTransaction, CatalogType } from './catalog.service';

function asText(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'object' && v && '#text' in (v as any)) return asText((v as any)['#text']);
  return '';
}

function parseStrictNumber(v: unknown): number | null {
  const s = asText(v).trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function parseStrictBool(v: unknown): boolean | null {
  const s = asText(v).trim().toLowerCase();
  if (!s) return null;
  if (s === 'true') return true;
  if (s === 'false') return false;
  return null;
}

function parseTags(v: unknown): string[] {
  const s = asText(v);
  if (!s) return [];
  return s.split(',').map((x) => x.trim()).filter(Boolean);
}

function parseEnum<T extends string>(v: unknown, allowed: readonly T[]): T | null {
  const s = asText(v).trim().toLowerCase();
  if (!s) return null;
  const found = allowed.find((a) => a === (s as T));
  return found ?? null;
}

function parseDateIso(v: unknown): string {
  const s = asText(v).trim();
  if (!s) return new Date().toISOString();
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return new Date().toISOString();
  return d.toISOString();
}

export type ImportMode = 'dry_run' | 'commit';

export type ImportResult = {
  import_run_id: string;
  seenCount: number;
  errorCount: number;
  errors: Array<{ id_unique?: string; reason: string }>;
};

export class CatalogImportService {
  static parseXmlListings(xmlText: string): any[] {
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '',
      trimValues: true,
      parseTagValue: false,
      parseAttributeValue: false,
    });

    const doc = parser.parse(xmlText);

    const pickArray = (v: any): any[] => {
      if (!v) return [];
      return Array.isArray(v) ? v : [v];
    };

    const direct =
      doc?.catalog?.listing ??
      doc?.catalogue?.listing ??
      doc?.listings?.listing ??
      doc?.listing ??
      doc?.listings ??
      doc?.annonces_immobilieres?.annonce ??
      doc?.properties?.property ??
      doc?.property;

    const directArr = pickArray(direct);
    if (directArr.length > 0) return directArr;

    const visited = new Set<any>();
    const findFirst = (node: any): any[] => {
      if (!node || typeof node !== 'object') return [];
      if (visited.has(node)) return [];
      visited.add(node);

      if (node.listing) {
        const arr = pickArray(node.listing);
        if (arr.length > 0) return arr;
      }
      if (node.property) {
        const arr = pickArray(node.property);
        if (arr.length > 0) return arr;
      }

      for (const k of Object.keys(node)) {
        const arr = findFirst((node as any)[k]);
        if (arr.length > 0) return arr;
      }
      return [];
    };

    return findFirst(doc);
  }

  static mapListingToProperty(listing: any, tenantId: string): { property: CatalogProperty | null; errors: string[] } {
    const errors: string[] = [];

    const isIndexationFormat = !!listing?.bien;

    let id_unique: string;
    let type: CatalogType | null;
    let transaction: CatalogTransaction | null;
    let statut: CatalogStatus;
    let prix: number | null;
    let charges: number | null;
    let tax_year: number | null;
    let surface_m2: number | null;
    let pieces: number | null;
    let chambres: number | null;
    let floor: number | null;
    let elevator: boolean | null;
    let ville: string | null;
    let code_postal: string | null;
    let country: string | null;
    let lat: number | null;
    let lon: number | null;
    let title: string | null;
    let description: string | null;
    let tags: string[];
    let url_annonce: string | null;
    let date_maj: string;
    let flagObj: Record<string, boolean | null>;

    if (isIndexationFormat) {
      const b = listing?.bien ?? {};

      id_unique = asText(b?.reference).trim();
      if (!id_unique) {
        errors.push('Missing reference');
        return { property: null, errors };
      }

      const rawType = asText(b?.type_bien).trim().toLowerCase();
      const normalizedType = rawType === 'villa' ? 'maison' : rawType;
      type = parseEnum<CatalogType>(normalizedType, ['maison', 'appartement', 'terrain', 'autre'] as const);
      if (rawType && !type) errors.push('Invalid type');

      transaction = parseEnum<CatalogTransaction>(b?.transaction, ['vente', 'location'] as const);
      if (b?.transaction && !transaction) errors.push('Invalid transaction');

      statut = 'disponible';

      prix = parseStrictNumber(b?.prix);
      charges = null;
      tax_year = null;

      surface_m2 = parseStrictNumber(b?.surface_m2);
      pieces = parseStrictNumber(b?.pieces);
      chambres = parseStrictNumber(b?.chambres);
      floor = parseStrictNumber(b?.etage);
      elevator = parseStrictBool(b?.ascenseur);

      ville = asText(b?.ville).trim() || null;
      code_postal = asText(b?.code_postal).trim() || null;
      country = null;

      lat = null;
      lon = null;

      title = asText(b?.titre).trim() || null;
      description = asText(b?.description).trim() || null;
      tags = [];

      url_annonce = null;
      date_maj = new Date().toISOString();

      flagObj = {
        has_balcony: parseStrictBool(b?.balcon) ?? parseStrictBool(b?.terrasse),
        has_garage: parseStrictBool(b?.garage),
        is_furnished: parseStrictBool(b?.meuble),
      };
    } else {
      id_unique = asText(listing?.id).trim();
      if (!id_unique) {
        errors.push('Missing id');
        return { property: null, errors };
      }

      const meta = listing?.structured_data?.listing_meta ?? {};
      const fin = listing?.structured_data?.financial ?? {};
      const phy = listing?.structured_data?.physical ?? {};
      const loc = listing?.structured_data?.location ?? {};
      const coords = loc?.coordinates ?? {};
      const flags = listing?.structured_data?.flags ?? {};
      const sem = listing?.semantic_content ?? {};

      type = parseEnum<CatalogType>(meta?.type, ['maison', 'appartement', 'terrain', 'autre'] as const);
      if (meta?.type && !type) errors.push('Invalid type');

      transaction = parseEnum<CatalogTransaction>(meta?.transaction, ['vente', 'location'] as const);
      if (meta?.transaction && !transaction) errors.push('Invalid transaction');

      const statutRaw = parseEnum<CatalogStatus>(meta?.statut, ['disponible', 'sous_offre', 'vendu', 'retire'] as const);
      if (meta?.statut && !statutRaw) errors.push('Invalid statut');
      statut = statutRaw ?? 'disponible';

      prix = parseStrictNumber(fin?.price);
      charges = parseStrictNumber(fin?.charges);
      tax_year = parseStrictNumber(fin?.tax_year);

      surface_m2 = parseStrictNumber(phy?.area);
      pieces = parseStrictNumber(phy?.rooms);
      chambres = parseStrictNumber(phy?.bedrooms);
      floor = parseStrictNumber(phy?.floor);
      elevator = parseStrictBool(phy?.elevator);

      ville = asText(loc?.city).trim() || null;
      code_postal = asText(loc?.postcode).trim() || null;
      country = asText(loc?.country).trim() || null;

      lat = parseStrictNumber(coords?.lat);
      lon = parseStrictNumber(coords?.lon);

      title = asText(sem?.title).trim() || null;
      description = asText(sem?.description).trim() || null;
      tags = parseTags(sem?.tags);

      url_annonce = asText(meta?.url_annonce).trim() || null;
      date_maj = parseDateIso(meta?.date_maj);

      flagObj = {
        has_balcony: parseStrictBool(flags?.has_balcony),
        has_garage: parseStrictBool(flags?.has_garage),
        is_furnished: parseStrictBool(flags?.is_furnished),
      };
    }

    const property: CatalogProperty = {
      tenant_id: tenantId,
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
      pieces: pieces != null ? Math.round(pieces) : null,
      chambres: chambres != null ? Math.round(chambres) : null,
      floor: floor != null ? Math.round(floor) : null,
      elevator,
      ville,
      code_postal,
      country,
      lat,
      lon,
      flags: flagObj,
      title,
      description,
      tags,
      photos_urls: [],
    };

    return { property, errors };
  }

  static async createImportRun(params: { tenantId: string; mode: ImportMode; sourceName?: string }): Promise<string> {
    const res = await pool.query(
      `INSERT INTO catalog_import_runs (tenant_id, mode, source_name)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [params.tenantId, params.mode, params.sourceName || null]
    );
    return res.rows[0].id;
  }

  static async finalizeImportRun(params: { importRunId: string; seenCount: number; errorCount: number }): Promise<void> {
    await pool.query(
      `UPDATE catalog_import_runs
       SET seen_count = $2, error_count = $3, committed_at = CASE WHEN mode = 'commit' THEN NOW() ELSE committed_at END
       WHERE id = $1`,
      [params.importRunId, params.seenCount, params.errorCount]
    );
  }

  static async recordError(importRunId: string, id_unique: string | null, reason: string): Promise<void> {
    await pool.query(
      `INSERT INTO catalog_import_errors (import_run_id, id_unique, reason)
       VALUES ($1, $2, $3)`,
      [importRunId, id_unique, reason]
    );
  }

  static async upsertProperty(p: CatalogProperty, importRunId: string): Promise<void> {
    const searchText = [
      p.title || '',
      p.description || '',
      (p.tags || []).join(' '),
      p.ville || '',
      p.code_postal || '',
      p.id_unique,
    ].join(' ').trim();

    await pool.query(
      `INSERT INTO catalog_properties (
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
        photos_urls,
        last_import_run_id,
        search_tsv
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,
        to_tsvector('simple', $27)
      )
      ON CONFLICT (tenant_id, id_unique) DO UPDATE SET
        type = EXCLUDED.type,
        transaction = EXCLUDED.transaction,
        statut = EXCLUDED.statut,
        url_annonce = EXCLUDED.url_annonce,
        date_maj = EXCLUDED.date_maj,
        prix = EXCLUDED.prix,
        charges = EXCLUDED.charges,
        tax_year = EXCLUDED.tax_year,
        surface_m2 = EXCLUDED.surface_m2,
        pieces = EXCLUDED.pieces,
        chambres = EXCLUDED.chambres,
        floor = EXCLUDED.floor,
        elevator = EXCLUDED.elevator,
        ville = EXCLUDED.ville,
        code_postal = EXCLUDED.code_postal,
        country = EXCLUDED.country,
        lat = EXCLUDED.lat,
        lon = EXCLUDED.lon,
        flags = EXCLUDED.flags,
        title = EXCLUDED.title,
        description = EXCLUDED.description,
        tags = EXCLUDED.tags,
        photos_urls = EXCLUDED.photos_urls,
        last_import_run_id = EXCLUDED.last_import_run_id,
        search_tsv = EXCLUDED.search_tsv`,
      [
        p.tenant_id,
        p.id_unique,
        p.type,
        p.transaction,
        p.statut,
        p.url_annonce,
        p.date_maj,
        p.prix,
        p.charges,
        p.tax_year,
        p.surface_m2,
        p.pieces,
        p.chambres,
        p.floor,
        p.elevator,
        p.ville,
        p.code_postal,
        p.country,
        p.lat,
        p.lon,
        JSON.stringify(p.flags || {}),
        p.title,
        p.description,
        p.tags,
        p.photos_urls,
        importRunId,
        searchText,
      ]
    );
  }

  static async markMissingAsRetired(params: { tenantId: string; importRunId: string; seenIds: Set<string> }): Promise<number> {
    const ids = Array.from(params.seenIds);

    if (ids.length === 0) {
      console.warn('[CatalogImport] seenIds is empty on commit; skipping retire-all safeguard', {
        tenantId: params.tenantId,
        importRunId: params.importRunId,
      });
      return 0;
    }

    const res = await pool.query(
      `UPDATE catalog_properties
       SET statut = 'retire', last_import_run_id = $3
       WHERE tenant_id = $1 AND id_unique <> ALL($2) AND statut <> 'retire'`,
      [params.tenantId, ids, params.importRunId]
    );

    return res.rowCount || 0;
  }

  static async runImport(params: { tenantId: string; xmlText: string; mode: ImportMode; sourceName?: string }): Promise<ImportResult> {
    const importRunId = await this.createImportRun({ tenantId: params.tenantId, mode: params.mode, sourceName: params.sourceName });

    const errors: ImportResult['errors'] = [];
    const seen = new Set<string>();

    const listings = this.parseXmlListings(params.xmlText);

    if (listings.length === 0) {
      const reason = 'No listings found in XML (expected nodes like <catalog><listing>...</listing></catalog>)';
      errors.push({ reason });
      await this.recordError(importRunId, null, reason);
      await this.finalizeImportRun({ importRunId, seenCount: 0, errorCount: 1 });
      return {
        import_run_id: importRunId,
        seenCount: 0,
        errorCount: 1,
        errors,
      };
    }

    for (const listing of listings) {
      const mapped = this.mapListingToProperty(listing, params.tenantId);

      if (!mapped.property) {
        const reason = mapped.errors[0] || 'Invalid listing';
        errors.push({ reason });
        await this.recordError(importRunId, null, reason);
        continue;
      }

      for (const e of mapped.errors) {
        errors.push({ id_unique: mapped.property.id_unique, reason: e });
        await this.recordError(importRunId, mapped.property.id_unique, e);
      }

      seen.add(mapped.property.id_unique);

      if (params.mode === 'commit') {
        await this.upsertProperty(mapped.property, importRunId);
      }
    }

    if (params.mode === 'commit') {
      await this.markMissingAsRetired({ tenantId: params.tenantId, importRunId, seenIds: seen });
    }

    await this.finalizeImportRun({ importRunId, seenCount: seen.size, errorCount: errors.length });

    return {
      import_run_id: importRunId,
      seenCount: seen.size,
      errorCount: errors.length,
      errors,
    };
  }
}
