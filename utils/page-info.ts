export interface PageInfo {
  title: string;
  url: string;
}

export function isPageInfo(value: unknown): value is PageInfo {
  return (
    typeof value === "object" &&
    value !== null &&
    "title" in value &&
    typeof value.title === "string" &&
    "url" in value &&
    typeof value.url === "string"
  );
}
