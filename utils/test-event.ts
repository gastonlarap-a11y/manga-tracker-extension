import type { CreateEventBody } from "./api/types";
import type { PageInfo } from "./page-info";

// Phase 5 handshake payload: real page data where available, fixed chapter
// label so test events are recognizable in the library.
export function buildTestEventPayload(page: PageInfo): CreateEventBody {
  const title = page.title.trim();
  return {
    mangaName: title.length > 0 ? title : "Untitled page",
    chapterLabel: "Cap. 0 (evento test)",
    sourceUrl: page.url,
  };
}
