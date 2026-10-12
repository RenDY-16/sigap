import type { RequestHandler } from "express";
import { STAFF_REQUEST_HEADER, STAFF_REQUEST_VALUE } from "../../shared/request-security.js";
import { ApiError } from "../errors.js";
import { isAllowedRequestOrigin } from "./request-origin.js";

const safeMethods = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * A custom header forces cross-origin browser requests to preflight. No CORS
 * permissions are granted by this app. Origin and Fetch Metadata checks provide
 * additional protection, including against same-site sibling origins.
 * This app does not trust forwarded host/protocol headers.
 */
export const guardStaffMutation: RequestHandler = (request, _response, next) => {
  if (safeMethods.has(request.method)) {
    next();
    return;
  }

  const fail = () => next(new ApiError(
    403,
    "staff_request_rejected",
    "Permintaan staf harus dikirim dari aplikasi SIGAP pada origin yang sama.",
  ));

  if (request.get(STAFF_REQUEST_HEADER) !== STAFF_REQUEST_VALUE) {
    fail();
    return;
  }

  if (!isAllowedRequestOrigin(
    request.get("Origin"), request.get("Sec-Fetch-Site"),
    request.get("Host"), request.secure,
  )) {
    fail();
    return;
  }

  // Older same-origin clients may omit Origin/Fetch Metadata. The custom
  // header is still mandatory; a cross-origin page cannot supply it without
  // a successful CORS preflight. Header values are not authentication secrets.
  next();
};
