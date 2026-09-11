import assert from "node:assert/strict";
import test from "node:test";
import { InfiniteQueryObserver, MutationObserver, QueryClient } from "@tanstack/react-query";
import { beginFeedAction, rollbackFeedAction, postActionKey, voteValue } from "../lib/feedActions.ts";

const post = (name, overrides = {}) => ({
  kind: "t3",
  data: { name, saved: false, hidden: false, likes: null, score: 10, title: name, ...overrides },
});
const feed = (posts, label) => ({
  pages: [{ filtered: posts, after: `${label}-next`, count: posts.length, prevPosts: { earlier: 1 }, filterCount: 2 }],
  pageParams: [{ cursor: label }],
});
const clientFor = (t) => {
  const client = new QueryClient({ defaultOptions: { queries: { cacheTime: Infinity } } });
  t.after(() => client.clear());
  return client;
};
const freeze = (value) => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(freeze);
  }
  return value;
};
const readPost = (client, key, name = "t3_target") =>
  client.getQueryData(key).pages.flatMap((page) => page.filtered).find((p) => p.data.name === name).data;

test("optimism leaves immutable snapshots and restores each feed to its own data", async (t) => {
  for (const change of [
    { property: "saved", value: true },
    { property: "hidden", value: true },
    { property: "likes", value: 1 },
  ]) {
    const client = clientFor(t);
    const home = ["feed", "HOME", { sort: "new" }];
    const sub = ["feed", "SUBREDDIT", "testing"];
    const first = feed([post("t3_target"), post("t3_home")], "home");
    const second = feed([post("t3_sub"), post("t3_target", { score: 50 })], "sub");
    client.setQueryData(home, first);
    client.setQueryData(sub, second);
    freeze(client.getQueryData(home));
    freeze(client.getQueryData(sub));
    const context = await beginFeedAction(client, "t3_target", change);
    const expected = change.property === "likes" ? true : change.value;
    assert.equal(readPost(client, home)[change.property], expected);
    assert.equal(readPost(client, sub)[change.property], expected);
    assert.equal(first.pages[0].filtered[0].data[change.property], change.property === "likes" ? null : false);
    assert.equal(client.getQueryData(home).pages[0].filtered[1], first.pages[0].filtered[1]);
    assert.equal(client.getQueryData(home).pageParams, first.pageParams);
    if (change.property === "likes") {
      assert.equal(readPost(client, home).score, 11);
      assert.equal(readPost(client, sub).score, 51);
    }
    await rollbackFeedAction(client, context);
    assert.deepEqual(client.getQueryData(home), first);
    assert.deepEqual(client.getQueryData(sub), second);
    assert.equal(Array.isArray(client.getQueryData(home)), false);
  }
});

test("unsetting saved and hidden flags rolls back to their original true values", async (t) => {
  const client = clientFor(t);
  const key = ["feed", "SELF"];
  for (const property of ["saved", "hidden"]) {
    client.setQueryData(key, feed([post("t3_target", { [property]: true })], property));
    const context = await beginFeedAction(client, "t3_target", { property, value: false });
    assert.equal(readPost(client, key)[property], false);
    await rollbackFeedAction(client, context);
    assert.equal(readPost(client, key)[property], true);
  }
});

test("vote transitions use canonical Reddit likes and restore score with the vote", async (t) => {
  const client = clientFor(t);
  const key = ["feed", "votes"];
  for (const [likes, original] of [[null, 0], [undefined, 0], [0, 0], [true, 1], [1, 1], [false, -1], [-1, -1]]) {
    assert.equal(voteValue(likes), original);
    for (const value of [-1, 0, 1]) {
      client.setQueryData(key, feed([post("t3_target", { likes, score: 100 })], "votes"));
      const before = client.getQueryData(key);
      const context = await beginFeedAction(client, "t3_target", { property: "likes", value });
      assert.equal(readPost(client, key).likes, value === 0 ? null : value === 1);
      assert.equal(readPost(client, key).score, 100 + value - original);
      await rollbackFeedAction(client, context);
      assert.deepEqual(client.getQueryData(key), before);
    }
  }
});

test("one failed action does not roll back another post, another field, or newly loaded pages", async (t) => {
  const client = clientFor(t);
  const key = ["feed", "HOME"];
  client.setQueryData(key, feed([post("t3_target"), post("t3_other")], "home"));
  const save = await beginFeedAction(client, "t3_target", { property: "saved", value: true });
  await beginFeedAction(client, "t3_other", { property: "hidden", value: true });
  await beginFeedAction(client, "t3_target", { property: "likes", value: 1 });
  client.setQueryData(key, (current) => ({
    ...current,
    pages: [...current.pages, { filtered: [post("t3_new")], after: null, count: 3, prevPosts: { added: 1 } }],
    pageParams: [...current.pageParams, { cursor: "next" }],
  }));
  await rollbackFeedAction(client, save);
  assert.equal(readPost(client, key).saved, false);
  assert.equal(readPost(client, key).likes, true);
  assert.equal(readPost(client, key).score, 11);
  assert.equal(readPost(client, key, "t3_other").hidden, true);
  assert.equal(client.getQueryData(key).pages.length, 2);
  assert.deepEqual(client.getQueryData(key).pageParams, [{ cursor: "home" }, { cursor: "next" }]);
});

test("two different actions can both fail in either order without corrupting a shared post", async (t) => {
  for (const reverse of [false, true]) {
    const client = clientFor(t);
    const key = ["feed", "HOME"];
    const before = feed([post("t3_target")], "home");
    client.setQueryData(key, before);
    const save = await beginFeedAction(client, "t3_target", { property: "saved", value: true });
    const vote = await beginFeedAction(client, "t3_target", { property: "likes", value: -1 });
    for (const context of reverse ? [vote, save] : [save, vote]) await rollbackFeedAction(client, context);
    assert.deepEqual(client.getQueryData(key), before);
  }
});

test("rollback preserves newer server values and unrelated fields", async (t) => {
  const client = clientFor(t);
  const key = ["feed", "HOME"];
  client.setQueryData(key, feed([post("t3_target")], "home"));
  const vote = await beginFeedAction(client, "t3_target", { property: "likes", value: 1 });
  client.setQueryData(key, feed([post("t3_target", { likes: -1, score: 99, title: "refetched" })], "server"));
  await rollbackFeedAction(client, vote);
  assert.equal(readPost(client, key).likes, -1);
  assert.equal(readPost(client, key).score, 99);
  assert.equal(readPost(client, key).title, "refetched");
});

test("missing targets and removed queries are not created or damaged during rollback", async (t) => {
  const client = clientFor(t);
  const key = ["feed", "HOME"];
  const before = feed([post("t3_other")], "home");
  client.setQueryData(key, before);
  const absent = await beginFeedAction(client, "t3_target", { property: "saved", value: true });
  await rollbackFeedAction(client, absent);
  await rollbackFeedAction(client, undefined);
  assert.equal(client.getQueryData(key), before);
  client.setQueryData(key, feed([post("t3_target")], "home"));
  const context = await beginFeedAction(client, "t3_target", { property: "hidden", value: true });
  client.removeQueries({ queryKey: key, exact: true });
  await rollbackFeedAction(client, context);
  assert.equal(client.getQueryData(key), undefined);
  assert.equal(client.getQueryCache().find({ queryKey: key, exact: true }), undefined);
});

test("rollback restores absent fields without introducing undefined properties", async (t) => {
  const client = clientFor(t);
  const key = ["feed", "HOME"];
  const before = feed([{ kind: "t3", data: { name: "t3_target", title: "minimal" } }], "home");
  client.setQueryData(key, before);
  const context = await beginFeedAction(client, "t3_target", { property: "saved", value: true });
  await rollbackFeedAction(client, context);
  assert.deepEqual(client.getQueryData(key), before);
});

test("mutation keys separate unrelated posts and actions", () => {
  assert.deepEqual(postActionKey("save", "t3_one"), ["post-action", "save", "t3_one"]);
  assert.notDeepEqual(postActionKey("save", "t3_one"), postActionKey("hide", "t3_one"));
  assert.notDeepEqual(postActionKey("save", "t3_one"), postActionKey("save", "t3_two"));
});

test("starting a feed action does not cancel an unrelated thread request", async (t) => {
  const client = clientFor(t);
  let finish;
  let cancelled = false;
  const pending = client.fetchQuery({
    queryKey: ["thread", "target"],
    queryFn: ({ signal }) => new Promise((resolve) => {
      finish = resolve;
      signal.addEventListener("abort", () => { cancelled = true; });
    }),
  });
  const context = await beginFeedAction(client, "t3_target", { property: "saved", value: true });
  await rollbackFeedAction(client, context);
  assert.equal(cancelled, false);
  finish("thread");
  assert.equal(await pending, "thread");
});

test("starting a feed action does not cancel unrelated feed pagination", async (t) => {
  const client = clientFor(t);
  const targetKey = ["feed", "target"];
  const unrelatedKey = ["feed", "unrelated"];
  client.setQueryData(targetKey, feed([post("t3_target")], "target"));
  let finishTarget;
  let targetCancelled = false;
  const targetObserver = new InfiniteQueryObserver(client, {
    queryKey: targetKey,
    queryFn: ({ signal }) => new Promise((resolve) => {
      finishTarget = resolve;
      signal.addEventListener("abort", () => { targetCancelled = true; });
    }),
    getNextPageParam: (page) => page.after,
    staleTime: Infinity,
  });
  t.after(targetObserver.subscribe(() => {}));
  client.setQueryData(unrelatedKey, {
    pages: [{ filtered: [post("t3_other")], after: "next" }],
    pageParams: [undefined],
  });
  let finish;
  let cancelled = false;
  const observer = new InfiniteQueryObserver(client, {
    queryKey: unrelatedKey,
    queryFn: ({ signal }) => new Promise((resolve) => {
      finish = resolve;
      signal.addEventListener("abort", () => { cancelled = true; });
    }),
    getNextPageParam: (page) => page.after,
    staleTime: Infinity,
  });
  t.after(observer.subscribe(() => {}));
  const targetPending = targetObserver.fetchNextPage();
  const pending = observer.fetchNextPage();
  const context = await beginFeedAction(client, "t3_target", { property: "saved", value: true });
  finishTarget({ filtered: [post("t3_late")], after: null });
  await targetPending;
  assert.equal(targetCancelled, true);
  assert.equal(readPost(client, targetKey).saved, true);
  assert.equal(client.getQueryData(targetKey).pages.length, 1);
  await rollbackFeedAction(client, context);
  finish({ filtered: [post("t3_next")], after: null });
  await pending;
  assert.equal(cancelled, false);
  assert.equal(client.getQueryData(unrelatedKey).pages.length, 2);
  assert.equal(readPost(client, targetKey).saved, false);
});

test("rollback finds a reordered target without changing inserted posts", async (t) => {
  const client = clientFor(t);
  const key = ["feed", "reordered"];
  client.setQueryData(key, feed([post("t3_target"), post("t3_other")], "home"));
  const context = await beginFeedAction(client, "t3_target", { property: "saved", value: true });
  client.setQueryData(key, (current) => ({
    ...current,
    pages: current.pages.map((page) => ({
      ...page,
      filtered: [post("t3_inserted", { saved: true }), ...page.filtered.slice(1), page.filtered[0]],
    })),
  }));
  await rollbackFeedAction(client, context);
  assert.equal(readPost(client, key).saved, false);
  assert.equal(readPost(client, key, "t3_inserted").saved, true);
  assert.equal(readPost(client, key, "t3_other").saved, false);
  assert.deepEqual(client.getQueryData(key).pages[0].filtered.map((entry) => entry.data.name), [
    "t3_inserted", "t3_other", "t3_target",
  ]);
});

test("rollback preserves a changed server vote pair even when one field matches the optimistic value", async (t) => {
  for (const serverVote of [{ likes: true, score: 99 }, { likes: false, score: 11 }]) {
    const client = clientFor(t);
    const key = ["feed", "refetched-vote"];
    client.setQueryData(key, feed([post("t3_target")], "home"));
    const context = await beginFeedAction(client, "t3_target", { property: "likes", value: 1 });
    await client.fetchQuery({
      queryKey: key,
      queryFn: async () => feed([post("t3_target", serverVote)], "server"),
    });
    const confirmed = client.getQueryData(key);
    await rollbackFeedAction(client, context);
    assert.equal(client.getQueryData(key), confirmed);
    assert.equal(readPost(client, key).likes, serverVote.likes);
    assert.equal(readPost(client, key).score, serverVote.score);
  }
});

test("rollback does not delete a refetched vote whose likes were originally absent", async (t) => {
  const client = clientFor(t);
  const key = ["feed", "absent-vote"];
  client.setQueryData(key, feed([{ kind: "t3", data: { name: "t3_target", score: 10 } }], "home"));
  const context = await beginFeedAction(client, "t3_target", { property: "likes", value: 1 });
  await client.fetchQuery({
    queryKey: key,
    queryFn: async () => feed([post("t3_target", { likes: true, score: 99 })], "server"),
  });
  await rollbackFeedAction(client, context);
  assert.equal(readPost(client, key).likes, true);
  assert.equal(readPost(client, key).score, 99);
});

test("optimism and rollback use the data left after affected-query cancellation", async (t) => {
  const client = clientFor(t);
  const key = ["feed", "cancellation-baseline"];
  client.setQueryData(key, feed([post("t3_target", { score: 10 })], "home"));
  let finish;
  const observer = new InfiniteQueryObserver(client, {
    queryKey: key,
    queryFn: () => new Promise((resolve) => { finish = resolve; }),
    getNextPageParam: (page) => page.after,
    staleTime: Infinity,
  });
  t.after(observer.subscribe(() => {}));
  const pending = observer.fetchNextPage();
  client.setQueryData(key, feed([post("t3_target", { score: 20 })], "intermediate"));
  const context = await beginFeedAction(client, "t3_target", { property: "likes", value: 1 });
  assert.equal(readPost(client, key).score, 11);
  finish({ filtered: [post("t3_late")], after: null });
  await pending;
  await rollbackFeedAction(client, context);
  assert.equal(readPost(client, key).score, 10);
  assert.equal(readPost(client, key).likes, null);
  assert.equal(client.getQueryData(key).pages.length, 1);
});

test("late pagination cannot resurrect a failed action and can be retried", async (t) => {
  const client = clientFor(t);
  const key = ["feed", "HOME"];
  const first = { filtered: [post("t3_target")], after: "next" };
  const second = { filtered: [post("t3_next")], after: null };
  client.setQueryData(key, { pages: [first], pageParams: [undefined] });
  let finish;
  const observer = new InfiniteQueryObserver(client, {
    queryKey: key,
    queryFn: () => new Promise((resolve) => { finish = resolve; }),
    getNextPageParam: (page) => page.after,
    staleTime: Infinity,
  });
  const unsubscribe = observer.subscribe(() => {});
  t.after(unsubscribe);
  const context = await beginFeedAction(client, "t3_target", { property: "saved", value: true });
  const pendingPage = observer.fetchNextPage();
  const finishStalePage = finish;
  await rollbackFeedAction(client, context);
  finishStalePage(second);
  await pendingPage;
  assert.equal(readPost(client, key).saved, false);
  assert.equal(observer.getCurrentResult().hasNextPage, true);
  const retry = observer.fetchNextPage();
  finish(second);
  await retry;
  assert.equal(readPost(client, key).saved, false);
  assert.equal(client.getQueryData(key).pages.length, 2);
});

test("pending state is synchronous and shared across observers of the same post action", async (t) => {
  const client = clientFor(t);
  const mutationKey = postActionKey("save", "t3_target");
  let release;
  const response = new Promise((resolve) => { release = resolve; });
  const first = new MutationObserver(client, { mutationKey, mutationFn: () => response });
  const second = new MutationObserver(client, { mutationKey, mutationFn: () => response });
  const pending = first.mutate({});
  assert.equal(second.getCurrentResult().isLoading, false);
  assert.equal(client.isMutating({ mutationKey }), 1);
  assert.equal(client.isMutating({ mutationKey: postActionKey("hide", "t3_target") }), 0);
  assert.equal(client.isMutating({ mutationKey: postActionKey("save", "t3_other") }), 0);
  release({});
  await pending;
  assert.equal(client.isMutating({ mutationKey }), 0);
});

test("comment actions do not touch feed entries", async (t) => {
  const client = clientFor(t);
  const key = ["feed", "comments"];
  const before = feed([post("t1_comment")], "comments");
  client.setQueryData(key, before);
  const context = await beginFeedAction(client, "t1_comment", { property: "hidden", value: true });
  await rollbackFeedAction(client, context);
  assert.equal(client.getQueryData(key), before);
});

test("duplicate occurrences retain their own original values even when the first copy is a no-op", async (t) => {
  for (const saved of [[false, true], [true, false]]) {
    const client = clientFor(t);
    const key = ["feed", "duplicates"];
    const before = {
      pages: saved.map((value) => ({ filtered: [post("t3_target", { saved: value })] })),
      pageParams: [undefined, "next"],
    };
    client.setQueryData(key, before);
    const context = await beginFeedAction(client, "t3_target", { property: "saved", value: true });
    await rollbackFeedAction(client, context);
    assert.deepEqual(client.getQueryData(key), before);
  }
});

test("rollback leaves newly appended copies of the same post untouched", async (t) => {
  const client = clientFor(t);
  const key = ["feed", "duplicates"];
  client.setQueryData(key, feed([post("t3_target")], "home"));
  const context = await beginFeedAction(client, "t3_target", { property: "saved", value: true });
  client.setQueryData(key, (current) => ({
    ...current,
    pages: [...current.pages, { filtered: [post("t3_target", { saved: true })], after: null }],
    pageParams: [...current.pageParams, "next"],
  }));
  await rollbackFeedAction(client, context);
  assert.equal(client.getQueryData(key).pages[0].filtered[0].data.saved, false);
  assert.equal(client.getQueryData(key).pages[1].filtered[0].data.saved, true);
});
