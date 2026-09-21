export interface TrackingTemplate {
  id: number;
  name: string;
  version: number;
  definition: { fields: string[]; states: string[]; updateTypes: string[] };
}
export interface TrackingSummary {
  noteId: number;
  extractionId: number | null;
  hasConfirmed: boolean;
  stale: boolean;
  status: string;
}
export interface TrackingSourceNote extends TrackingSummary {
  id: number;
  title: string;
  recordedAt: string;
  eligible: number;
  folder_id: number | null;
}
export interface TrackingSourceList {
  items: TrackingSourceNote[];
  total: number;
  page: number;
}
export interface PendingTrackingNote {
  id: number;
  extractionId: number;
  title: string;
  folder_id: number | null;
  recordedAt: string;
  stale: boolean;
  itemCount: number;
  updateCount: number;
}
export interface PendingTrackingList {
  items: PendingTrackingNote[];
  total: number;
  page: number;
}
export interface TrackingItem {
  id: number;
  template_id: number;
  title: string;
  itemType: string;
  state: string;
  properties_json: string;
  properties: Record<string, unknown>;
  is_active: number;
  isActive: boolean;
  manual_state: number;
  state_source_update_id: number | null;
  created_at: string;
  updated_at: string;
  latestContent?: string | null;
  latestRecordedAt?: string | null;
}
export interface TrackingQuery {
  search?: string;
  templateId?: number | null;
  state?: string;
  active?: "all" | "active" | "inactive";
  page?: number;
}
export interface TrackingList {
  items: TrackingItem[];
  total: number;
  states: string[];
  page: number;
}
export interface TrackingDetail {
  item: TrackingItem;
  updates: {
    items: Array<{
      id: number;
      update_type: string;
      content: string;
      occurred_at: string | null;
      unknown_date: number;
      created_at: string;
      evidence_text: string;
      state_after: string | null;
      note_id: number;
      note_title: string | null;
      note_deleted_at: string | null;
    }>;
    total: number;
    page: number;
  };
  notes: Array<{
    id: number;
    title: string | null;
    folder_id: number | null;
    deleted_at: string | null;
  }>;
  relations: Array<{
    id: number;
    item_id: number;
    related_item_id: number;
    relation_type: string;
    source_title: string;
    target_title: string;
    evidence_text: string;
  }>;
  operations: Array<{
    id: number;
    operation: string;
    before_json: string;
    after_json: string;
    entrypoint: string;
    created_at: string;
  }>;
}
export interface TrackingItemPatch {
  title?: string;
  state?: string;
  isActive?: boolean;
  properties?: Record<string, unknown>;
  removePropertyKeys?: string[];
}
