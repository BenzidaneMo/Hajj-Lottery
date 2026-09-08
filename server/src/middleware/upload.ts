import { MAX_IMPORT_FILE_BYTES } from '@hajj-lottery/shared'
import type { RequestHandler } from 'express'
import multer from 'multer'

import { BadRequestError } from '../lib/errors.js'

/**
 * The one multipart endpoint in the system, and the limits it accepts under.
 *
 * Memory storage rather than a temporary directory, deliberately. A disk-backed
 * upload needs a location, a naming scheme, a cleanup path and a guarantee that
 * a client-supplied filename never reaches any of them — four opportunities to
 * get path handling wrong in exchange for nothing, since the file is parsed once
 * and never needed again. Holding it in the request buffer makes traversal and
 * leftover-file problems structurally impossible instead of carefully avoided.
 *
 * The size limit is enforced here, before the bytes are all in memory, rather
 * than checked afterwards: a limit you only discover having exceeded is not a
 * limit on what you allocated.
 */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_IMPORT_FILE_BYTES,
    files: 1,
    // The form carries the register and nothing else. Everything the import needs
    // to know comes from the session and the file.
    fields: 4,
    fieldSize: 1024,
    parts: 8,
  },
})

/** Accepts exactly one file, under the field name `file`. */
export const acceptImportUpload: RequestHandler = (req, res, next) => {
  upload.single('file')(req, res, (error: unknown) => {
    if (!error) return next()

    if (error instanceof multer.MulterError) {
      // Translated into the API's own vocabulary. Multer's messages name its
      // internals, and its "file too large" is a 500 unless it is caught here.
      const code = error.code === 'LIMIT_FILE_SIZE' ? 'PAYLOAD_TOO_LARGE' : 'MALFORMED_IMPORT_FILE'
      const message =
        error.code === 'LIMIT_FILE_SIZE'
          ? `An import file may be at most ${Math.floor(MAX_IMPORT_FILE_BYTES / (1024 * 1024))} MB`
          : 'The upload could not be read as a single file named "file"'

      return next(new BadRequestError(code, message))
    }

    return next(error)
  })
}
