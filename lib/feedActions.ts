import type { InfiniteData, QueryClient, QueryKey } from "@tanstack/react-query";

export type VoteValue = -1 | 0 | 1;
export type PostAction = "save" | "hide" | "vote";
export type FeedChange =
  | { property: "saved" | "hidden"; value: boolean }
  | { property: "likes"; value: VoteValue };

type PostData = {
  name: string;
  saved?: boolean;
  hidden?: boolean;
  likes?: boolean | VoteValue | null;
  score?: number;
  [key: string]: unknown;
};
type FeedPost = { data: PostData; [key: string]: unknown };
type FeedPage = { filtered: FeedPost[]; [key: string]: unknown };
type FeedData = InfiniteData<FeedPage>;
type Field = "saved" | "hidden" | "likes" | "score";
type FieldChange = {
  property: Field;
  before: PostData[Field];
  after: PostData[Field];
  present: boolean;
};
export type FeedActionContext = {
  id: string;
  queries: {
    key: QueryKey;
    posts: { occurrence: number; fields: FieldChange[] }[];
  }[];
};

export const postActionKey = (action: PostAction, id?: string) => ["post-action", action, id] as const;

export function voteValue(likes: unknown): VoteValue {
  return likes === true || likes === 1 ? 1 : likes === false || likes === -1 ? -1 : 0;
}

function fieldsFor(data: PostData, change: FeedChange): FieldChange[] {
  const field = (property: Field, after: PostData[Field]): FieldChange => ({
    property, before: data[property], after,
    present: Object.prototype.hasOwnProperty.call(data, property),
  });
  if (change.property !== "likes") return [field(change.property, change.value)];
  const fields = [field("likes", change.value === 0 ? null : change.value === 1)];
  if (typeof data.score === "number") {
    fields.push(field("score", data.score + change.value - voteValue(data.likes)));
  }
  return fields;
}

function writeFields(data: PostData, fields: FieldChange[], restore: boolean): PostData {
  const next = { ...data };
  for (const field of fields) {
    if (restore && !field.present) delete next[field.property];
    else Object.assign(next, { [field.property]: restore ? field.before : field.after });
  }
  return next;
}

function mapPostOccurrences(
  data: FeedData | undefined,
  id: string,
  update: (post: PostData, occurrence: number) => PostData
): FeedData | undefined {
  if (!data) return data;
  let changed = false;
  let occurrence = 0;
  const pages = data.pages.map((page) => {
    let pageChanged = false;
    const filtered = page.filtered.map((post) => {
      if (post.data.name !== id) return post;
      // Count no-op copies too; duplicate baselines are paired in encounter order.
      const next = update(post.data, occurrence++);
      if (next === post.data) return post;
      changed = pageChanged = true;
      return { ...post, data: next };
    });
    return pageChanged ? { ...page, filtered } : page;
  });
  return changed ? { ...data, pages } : data;
}

export async function beginFeedAction(
  client: QueryClient,
  id: string,
  change: FeedChange
): Promise<FeedActionContext> {
  const context: FeedActionContext = { id, queries: [] };
  if (!id.startsWith("t3_")) return context;
  const keys = client.getQueriesData<FeedData>({ queryKey: ["feed"] })
    .filter(([, data]) => data?.pages?.some((page) => page.filtered.some((post) => post.data.name === id)))
    .map(([key]) => key);
  await Promise.all(keys.map((key) => client.cancelQueries({ queryKey: key, exact: true })));
  for (const key of keys) {
    const posts: FeedActionContext["queries"][number]["posts"] = [];
    client.setQueryData<FeedData>(key, (data) => mapPostOccurrences(data, id, (post, occurrence) => {
      const fields = fieldsFor(post, change);
      if (fields.every((field) => field.present && Object.is(field.before, field.after))) return post;
      posts.push({ occurrence, fields });
      return writeFields(post, fields, false);
    }));
    if (posts.length) context.queries.push({ key, posts });
  }
  return context;
}

export async function rollbackFeedAction(client: QueryClient, context?: FeedActionContext) {
  if (!context) return;
  // Pagination can start after onMutate and still hold the optimistic first page.
  await Promise.all(context.queries.map(({ key }) => client.cancelQueries({ queryKey: key, exact: true })));
  for (const query of context.queries) {
    client.setQueryData<FeedData>(query.key, (data) => mapPostOccurrences(data, context.id, (post, occurrence) => {
      const fields = query.posts.find((entry) => entry.occurrence === occurrence)?.fields;
      // A refetch supplies likes and score together, even if the vote response failed.
      return fields?.every((field) => Object.is(post[field.property], field.after))
        ? writeFields(post, fields, true) : post;
    }));
  }
}
