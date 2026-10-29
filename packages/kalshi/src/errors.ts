/**
 * Kalshi-specific error types.
 *
 * Re-exports the common HTTP errors from core and adds the Kalshi fallback
 * errors. Note the generated service module additionally defines its own
 * per-status matcher classes (BadRequest/NotFound/...) for the statuses each
 * operation declares -- those share `_tag`s with the core classes here, so
 * `catchTag` works against either.
 */
export {
  BadGateway,
  BadRequest,
  Conflict,
  ConfigError,
  Forbidden,
  GatewayTimeout,
  InternalServerError,
  Locked,
  NotFound,
  ServiceUnavailable,
  TooManyRequests,
  Unauthorized,
  UnprocessableEntity,
  HTTP_STATUS_MAP,
  DEFAULT_ERRORS,
  API_ERRORS,
} from "@distilled.cloud/core/errors";
export type { DefaultErrors } from "@distilled.cloud/core/errors";

import * as Category from "@distilled.cloud/core/category";
import * as Schema from "@distilled.cloud/core/schema-lite-typed";

/** Unknown Kalshi error -- returned when nothing else matches the failure. */
export class UnknownKalshiError
  extends /*@__PURE__*/ Schema.TaggedError<UnknownKalshiError>()("UnknownKalshiError", {
    code: /*@__PURE__*/ Schema.optional(Schema.String),
    message: /*@__PURE__*/ Schema.optional(Schema.String),
    body: Schema.Unknown,
  }).pipe(Category.withServerError) {}

/** A 2xx body that does not match the operation output in a validating ResponseValidation mode. */
export class KalshiParseError
  extends /*@__PURE__*/ Schema.TaggedError<KalshiParseError>()("KalshiParseError", {
    body: Schema.Unknown,
    cause: Schema.Unknown,
  }).pipe(Category.withParseError) {}
