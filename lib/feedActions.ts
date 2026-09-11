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
    posts: { pageIndex: number; postIndex: number; fields: FieldChange[] }[];
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

export async function beginFeedAction(
  client: QueryClient,
  id: string,
  change: FeedChange
): Promise<FeedActionContext> {
  const context: FeedActionContext = { id, queries: [] };
  if (!id.startsWith("t3_")) return context;
  await client.cancelQueries({ queryKey: ["feed"] });
  for (const query of client.getQueryCache().findAll({ queryKey: ["feed"] })) {
    const posts: FeedActionContext["queries"][number]["posts"] = [];
    client.setQueryData<FeedData>(query.queryKey, (data) => {
      if (!data) return data;
      const pages = data.pages.map((page, pageIndex) => {
        let changed = false;
        const filtered = page.filtered.map((post, postIndex) => {
          if (post.data.name !== id) return post;
          const fields = fieldsFor(post.data, change);
          if (fields.every((field) => field.present && Object.is(field.before, field.after))) return post;
          posts.push({ pageIndex, postIndex, fields });
          changed = true;
          return { ...post, data: writeFields(post.data, fields, false) };
        });
        return changed ? { ...page, filtered } : page;
      });
      return posts.length ? { ...data, pages } : data;
    });
    if (posts.length) context.queries.push({ key: query.queryKey, posts });
  }
  return context;
}

export async function rollbackFeedAction(client: QueryClient, context?: FeedActionContext) {
  if (!context) return;
  // Pagination can start after onMutate and still hold the optimistic first page.
  await Promise.all(context.queries.map(({ key }) => client.cancelQueries({ queryKey: key, exact: true })));
  for (const query of context.queries) {
    client.setQueryData<FeedData>(query.key, (data) => {
      if (!data) return data;
      let pages = data.pages;
      for (const { pageIndex, postIndex, fields } of query.posts) {
        const page = pages[pageIndex];
        const post = page?.filtered[postIndex];
        // Don't overwrite changed values from a refetch or another action.
        if (post?.data.name !== context.id ||
            !fields.every((field) => Object.is(post.data[field.property], field.after))) continue;
        if (pages === data.pages) pages = [...pages];
        const filtered = [...page.filtered];
        filtered[postIndex] = { ...post, data: writeFields(post.data, fields, true) };
        pages[pageIndex] = { ...page, filtered };
      }
      return pages === data.pages ? data : { ...data, pages };
    });
  }
}
