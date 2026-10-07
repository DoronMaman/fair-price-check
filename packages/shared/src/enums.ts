import { z } from 'zod';

// Closed enums with English codes; Hebrew labels live next to them so the UI
// and the LLM prompt use exactly the same wording as the source data.

export const PROPERTY_TYPES = [
  'apartment',
  'duplex',
  'penthouse',
  'garden_apartment',
  'roof_apartment',
  'private_house',
] as const;
export const PropertyTypeSchema = z.enum(PROPERTY_TYPES);
export type PropertyType = z.infer<typeof PropertyTypeSchema>;

export const PROPERTY_TYPE_LABELS_HE: Record<PropertyType, string> = {
  apartment: 'דירה',
  duplex: 'דופלקס',
  penthouse: 'פנטהאוז',
  garden_apartment: 'דירת גן',
  roof_apartment: 'דירת גג',
  private_house: 'בית פרטי',
};

/** Plural forms, for phrases like "12 עסקאות של דירות גן". */
export const PROPERTY_TYPE_PLURAL_HE: Record<PropertyType, string> = {
  apartment: 'דירות',
  duplex: 'דופלקסים',
  penthouse: 'פנטהאוזים',
  garden_apartment: 'דירות גן',
  roof_apartment: 'דירות גג',
  private_house: 'בתים פרטיים',
};

export const CONDITIONS = ['needs_renovation', 'new_from_contractor', 'maintained', 'good', 'renovated'] as const;
export const ConditionSchema = z.enum(CONDITIONS);
export type Condition = z.infer<typeof ConditionSchema>;

export const CONDITION_LABELS_HE: Record<Condition, string> = {
  needs_renovation: 'דורש שיפוץ',
  new_from_contractor: 'חדש מקבלן',
  maintained: 'שמור',
  good: 'במצב טוב',
  renovated: 'משופץ',
};

// Order matters: earlier = more trusted when the same deal_id has conflicting rows.
// Tax-authority records are the registered transaction; broker/owner figures are reported.
export const SOURCES = ['tax_authority', 'broker', 'owner'] as const;
export const SourceSchema = z.enum(SOURCES);
export type Source = z.infer<typeof SourceSchema>;

export const SOURCE_LABELS_HE: Record<Source, string> = {
  tax_authority: 'רשות המסים',
  broker: 'מתווך',
  owner: 'בעל נכס',
};

/** Reverse lookup from an exact Hebrew label (already trimmed) to its enum code. */
export function fromHebrewLabel<T extends string>(labels: Record<T, string>, value: string): T | null {
  for (const [code, label] of Object.entries(labels) as [T, string][]) {
    if (label === value) return code;
  }
  return null;
}
