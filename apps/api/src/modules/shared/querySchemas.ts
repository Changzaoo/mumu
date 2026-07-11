import { z } from 'zod';

/** Local (non-contract) helper for simple `?limit=` endpoints. */
export const limitQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(10),
});
export type LimitQuery = z.infer<typeof limitQuerySchema>;
