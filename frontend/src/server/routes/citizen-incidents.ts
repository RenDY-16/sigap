import { Router, type Request } from "express";

import type { IncidentServices } from "../services/incident-service.js";
import { ApiError } from "../errors.js";

function bearerToken(request: Request): string {
  const authorization = request.get("authorization");
  if (!authorization) {
    throw new ApiError(401, "missing_bearer_token", "A citizen bearer token is required.");
  }
  // Supplied but malformed/unknown credentials flow through the same digest lookup result,
  // so citizens cannot distinguish token syntax from whether a token exists.
  const match = /^Bearer (.*)$/s.exec(authorization);
  return match?.[1] ?? "";
}

export function createCitizenIncidentsRouter(services: IncidentServices): Router {
  const router = Router();

  router.post("/incidents", async (request, response) => {
    const key = request.get("idempotency-key");
    if (!key) {
      throw new ApiError(400, "missing_idempotency_key", "Idempotency-Key is required.");
    }
    const incident = await services.createIncident(request.body, bearerToken(request), key);
    response.status(201).json(incident);
  });

  router.get("/incidents", async (request, response) => {
    response.json(await services.getIncidentForCitizen(bearerToken(request)));
  });

  router.post("/incidents/withdrawal", async (request, response) => {
    response.json(await services.requestWithdrawal(bearerToken(request)));
  });

  router.put("/incidents/location", async (request, response) => {
    response.json(
      await services.updateIncidentLocation(bearerToken(request), request.body, "simulation"),
    );
  });

  return router;
}
