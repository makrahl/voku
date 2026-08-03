import { z } from 'zod';

/** Images arrive as data: URIs so nothing has to be fetched from the open web. */
export const TranscribeSchema = z.object({
  images: z
    .array(z.string().regex(/^data:image\/(png|jpe?g|webp|gif);base64,/, 'must be an image data URI'))
    .min(1)
    .max(6),
});
