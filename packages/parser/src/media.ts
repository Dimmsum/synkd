// File types a schedule can come in (FR-IMP-1), and which of them can go straight to a model.

/** Extensions accepted as schedule files, lower-case and without the dot (FR-IMP-1). */
export const SCHEDULE_FILE_EXTENSIONS = [
  'pdf',
  'png',
  'jpg',
  'jpeg',
  'webp',
  'heic',
  'heif',
] as const;
export type ScheduleFileExtension = (typeof SCHEDULE_FILE_EXTENSIONS)[number];

/** Media types OpenRouter accepts for images and files. HEIC must be converted to JPEG first. */
export const MODEL_MEDIA_TYPES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
] as const;
export type ModelMediaType = (typeof MODEL_MEDIA_TYPES)[number];

const EXTENSION_MEDIA_TYPES: Record<ScheduleFileExtension, ModelMediaType | null> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  // No vision model on OpenRouter takes HEIC. The upload flow converts it (WF-024, WF-026).
  heic: null,
  heif: null,
};

export function isScheduleFileExtension(ext: string): ext is ScheduleFileExtension {
  return (SCHEDULE_FILE_EXTENSIONS as readonly string[]).includes(ext);
}

/** The media type to send to the model, or `null` if the file must be converted first. */
export function modelMediaType(ext: ScheduleFileExtension): ModelMediaType | null {
  return EXTENSION_MEDIA_TYPES[ext];
}

/**
 * Checks the file's leading bytes match its media type, so a mislabelled file fails
 * early with a clear error instead of an opaque model error (NFR-SEC-6 uses the same idea).
 */
export function matchesMagicBytes(bytes: Uint8Array, mediaType: ModelMediaType): boolean {
  const starts = (...sig: number[]) => sig.every((b, i) => bytes[i] === b);
  switch (mediaType) {
    case 'application/pdf':
      return starts(0x25, 0x50, 0x44, 0x46); // %PDF
    case 'image/png':
      return starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
    case 'image/jpeg':
      return starts(0xff, 0xd8, 0xff);
    case 'image/webp':
      // RIFF....WEBP
      return (
        starts(0x52, 0x49, 0x46, 0x46) &&
        bytes[8] === 0x57 &&
        bytes[9] === 0x45 &&
        bytes[10] === 0x42 &&
        bytes[11] === 0x50
      );
  }
}
