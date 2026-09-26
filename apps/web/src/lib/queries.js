/**
 * Elixir Clan's queries: one place for keys and one hook per read.
 *
 * Key convention, Elixir's: the reader's own things start with "me" -
 * the session ["me"], their away note ["me", "away", tag] - so
 * invalidating ["me"] refetches everything that is theirs. A clan's
 * reads start with its tag: ["clan", tag, "manage"], so a decision on
 * an action can invalidate the whole clan or one read of it.
 *
 * Most of this app's reads gate on status - 401 is the session gone,
 * 403 is the role refusing - so they keep the ENVELOPE (answered()) and
 * useGated() turns it into the { loading, signedOut, forbidden, error,
 * data } shape the views were written against. `load(true)` is the
 * server-side refresh (?refresh=1: the Lambda re-reads Elixir) and
 * writes the answer into the cache; `load()` is a plain refetch.
 */
import { useCallback, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  answered,
  transportFailed,
  unwrap,
} from "elixir-mcp/packages/client/src/index.ts";
import { api, feedbackApi, manageApi } from "../api.js";

export const keys = {
  me: ["me"],
  away: (tag) => ["me", "away", tag],
  place: ["me", "place"],
  feedback: ["me", "feedback"],
  feedbackItem: (id) => ["me", "feedback", id],
  clan: (tag) => ["clan", tag],
  roster: (tag) => ["clan", tag, "roster"],
  manage: (tag) => ["clan", tag, "manage"],
  history: (tag) => ["clan", tag, "history"],
  policy: (tag) => ["clan", tag, "policy"],
  awards: (tag) => ["clan", tag, "awards"],
  recruit: (tag) => ["clan", tag, "recruit"],
  model: (tag) => ["clan", tag, "model"],
  sharing: (tag) => ["clan", tag, "sharing"],
  map: (tag) => ["clan", tag, "map"],
  social: (tag) => ["clan", tag, "social"],
  standing: (tag) => ["clan", tag, "standing"],
  trophies: (tag) => ["clan", tag, "trophies"],
  actions: (tag) => ["clan", tag, "actions"],
  action: (tag, number) => ["clan", tag, "actions", number],
  memberView: (tag) => ["clan", tag, "me"],
  memberNotes: (tag, player) => ["clan", tag, "member", player, "notes"],
  memberAwards: (tag, player) => ["clan", tag, "member", player, "awards"],
  maintain: ["maintain", "feedback"],
};

const payload = (call) => () => call().then(unwrap);

/** The session envelope: 401 is "signed out", and the view reads it. */
export const useMeQuery = () =>
  useQuery({ queryKey: keys.me, queryFn: answered(() => api.me()) });

function gate(env) {
  if (env.status === 401) return { signedOut: true };
  if (env.status === 403) return { forbidden: env.data?.error ?? true };
  if (!env.ok) return { error: env.data?.error ?? env.error ?? "failed" };
  return { data: env.data };
}

/** A gated read with a server-side refresh. `read(refresh)` is the
 *  api call; `state` is the shape the views read; `load(true)` asks the
 *  Lambda to re-read Elixir and puts the answer in the cache. */
export function useGated(
  queryKey,
  read,
  { enabled = true, refetchInterval } = {},
) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey,
    queryFn: answered(() => read(false)),
    enabled,
    refetchInterval,
  });
  const [refreshing, setRefreshing] = useState(false);
  const keyId = JSON.stringify(queryKey);
  const { refetch } = query;
  const load = useCallback(
    async (refresh = false) => {
      if (!refresh) return refetch();
      setRefreshing(true);
      const r = await read(true);
      if (!transportFailed(r)) queryClient.setQueryData(JSON.parse(keyId), r);
      setRefreshing(false);
      return r;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- read is keyed by keyId
    [keyId, refetch, queryClient],
  );
  const env = query.data;
  const state = {
    loading: query.isFetching || refreshing,
    ...(query.isError ? { error: query.error.message } : {}),
    ...(env ? gate(env) : {}),
  };
  return { state, load, updatedAt: query.dataUpdatedAt, query };
}

export const useRoster = (tag) =>
  useGated(keys.roster(tag), (refresh) => api.roster(tag, refresh));

export const useManage = (tag, enabled = true) =>
  useGated(keys.manage(tag), (refresh) => manageApi.manage(tag, refresh), {
    enabled,
  });

export const useAwards = (tag) =>
  useGated(keys.awards(tag), (refresh) => manageApi.awards(tag, refresh));

/** A pending live read asks again after Elixir's retry_after_s. */
export const useRecruit = (tag) =>
  useGated(keys.recruit(tag), (refresh) => manageApi.recruit(tag, refresh), {
    refetchInterval: (q) => {
      const s = q.state.data?.data?.pending?.retry_after_s;
      return s ? Math.min(60, s) * 1000 : false;
    },
  });

/** The clan's own model: its key (never the key itself) and its uses. */
export const useModel = (tag) =>
  useGated(keys.model(tag), () => manageApi.model(tag));

/** What the clan records in Elixir, and who sees it there (read-only). */
export const useSharing = (tag) =>
  useGated(keys.sharing(tag), () => manageApi.sharing(tag));

/** Social (2026-09-26): the clan map, the clan's switch, your place. */
export const useClanMap = (tag) =>
  useGated(keys.map(tag), () => manageApi.map(tag));
export const useSocial = (tag) =>
  useGated(keys.social(tag), () => manageApi.social(tag));
export const useMyPlace = () =>
  useQuery({ queryKey: keys.place, queryFn: payload(() => api.myPlace()) });

export const useHistory = (tag) =>
  useQuery({
    queryKey: keys.history(tag),
    queryFn: async () => {
      const r = await manageApi.history(tag);
      return r.ok ? r.data : { cards: [], holds: [], timeline: [] };
    },
  });

export const usePolicy = (tag) =>
  useQuery({
    queryKey: keys.policy(tag),
    queryFn: payload(() => manageApi.policy(tag)),
  });

export const useStanding = (tag) =>
  useQuery({
    queryKey: keys.standing(tag),
    queryFn: answered(() => manageApi.standing(tag)),
  });

export const useMemberView = (tag) =>
  useGated(keys.memberView(tag), () => manageApi.memberView(tag));

export const useActions = (tag) =>
  useGated(keys.actions(tag), (refresh) => manageApi.actions(tag, refresh));

/** One action by its number; under the list's key, so a change to the
 *  list refetches it too. */
export const useAction = (tag, number) =>
  useGated(keys.action(tag, number), () => manageApi.action(tag, number));

export const useTrophies = (tag) =>
  useGated(keys.trophies(tag), () => manageApi.trophies(tag));

export const useMyAway = (tag) =>
  useQuery({
    queryKey: keys.away(tag),
    queryFn: payload(() => manageApi.myAway(tag)),
    enabled: Boolean(tag),
  });

export const useFeedbackList = () =>
  useQuery({ queryKey: keys.feedback, queryFn: payload(feedbackApi.list) });

export const useFeedbackItem = (id) =>
  useQuery({
    queryKey: keys.feedbackItem(id),
    queryFn: payload(() => feedbackApi.item(id)),
    enabled: Boolean(id),
  });

/** The maintainer's queue keeps the envelope: 403 is "not the maintainer". */
export const useMaintainQueue = () =>
  useQuery({ queryKey: keys.maintain, queryFn: answered(feedbackApi.queue) });

export const useMemberNotes = (tag, player) =>
  useQuery({
    queryKey: keys.memberNotes(tag, player),
    queryFn: async () => {
      const r = await manageApi.notes(tag, player);
      return r.ok ? r.data.notes : [];
    },
  });

export const useMemberAwards = (tag, player) =>
  useQuery({
    queryKey: keys.memberAwards(tag, player),
    queryFn: async () => {
      const r = await manageApi.memberAwards(tag, player);
      return r.ok ? r.data.grants : [];
    },
  });

/** `invalidate(keys.clan(tag))` after a decision: every read of that
 *  clan refetches. No key is the session and everything the reader's. */
export function useInvalidate() {
  const queryClient = useQueryClient();
  return (queryKey = keys.me) => queryClient.invalidateQueries({ queryKey });
}
