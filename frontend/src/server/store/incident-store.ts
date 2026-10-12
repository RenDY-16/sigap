import type { IncidentRecord } from "../../shared/domain.js";

/** Process-local store for the demo. Restarting the server clears all incidents. */
export class IncidentStore {
  private readonly recordsById = new Map<string, IncidentRecord>();
  private readonly idsByAccessTokenDigest = new Map<string, string>();

  getById(id: string): IncidentRecord | undefined {
    return this.recordsById.get(id);
  }

  getByAccessTokenDigest(digest: string): IncidentRecord | undefined {
    const id = this.idsByAccessTokenDigest.get(digest);
    return id ? this.recordsById.get(id) : undefined;
  }

  list(): IncidentRecord[] {
    return [...this.recordsById.values()];
  }

  insert(record: IncidentRecord): void {
    this.recordsById.set(record.id, record);
    this.idsByAccessTokenDigest.set(record.accessTokenDigest, record.id);
  }

  replace(record: IncidentRecord): void {
    if (!this.recordsById.has(record.id)) return;
    this.recordsById.set(record.id, record);
  }
}
