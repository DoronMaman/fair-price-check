import { z } from 'zod';
import { CanonicalCitySchema } from './cityAliases.js';
import { PropertyTypeSchema } from './enums.js';
import { LIMITS } from './limits.js';

/** A validated search: what the analytics engine accepts. */
export const PropertyQuerySchema = z.object({
  city: CanonicalCitySchema,
  neighborhood: z.string().trim().min(1).optional(),
  propertyType: PropertyTypeSchema.optional(),
  rooms: z.number().min(LIMITS.rooms.min).max(LIMITS.rooms.max).multipleOf(LIMITS.rooms.step).optional(),
  sizeSqm: z.number().min(LIMITS.sizeSqm.min).max(LIMITS.sizeSqm.max).optional(),
  floor: z.number().int().min(LIMITS.floor.min).max(LIMITS.floor.max).optional(),
  hasElevator: z.boolean().optional(),
  hasParking: z.boolean().optional(),
  hasSafeRoom: z.boolean().optional(),
  askingPriceNis: z.number().int().min(LIMITS.priceNis.min).max(LIMITS.priceNis.max).optional(),
});
export type PropertyQuery = z.infer<typeof PropertyQuerySchema>;
