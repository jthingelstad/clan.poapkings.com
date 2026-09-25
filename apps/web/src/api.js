/** Same-origin /api/*, cookie-authed. Every answer is `{ ok, status, data }`;
 *  a non-JSON body (an edge error page) is a failure whatever its status.
 *  The envelope, timeout and failure accounting are the family's, in
 *  Elixir's client package; this file is only this app's route map. */

import { createClient } from "elixir-mcp/packages/client/src/index.ts";
import { routeLabel, trackEvent } from "./analytics.js";

const client = createClient({
  // A failure that never reached the origin is the class of problem only
  // the browser can count (Elixir's lesson); a slow one is counted too.
  onEvent: (event, label) => trackEvent(`web.${event}`, label),
  onSlow: (info) => console.warn("[elixir-clan] slow request", info),
  // Routes carry the clan tag; the label masks it (analytics.js).
  routeLabel,
});

const get = (path) => client.get(path);
const post = (path, body) => client.post(path, body);
const put = (path, body) => client.request("PUT", path, body);
const del = (path) => client.request("DELETE", path);

const clanBase = (tag) => `/api/clans/${String(tag).replace(/^#/, "")}`;

export const manageApi = {
  manage: (tag, refresh = false) =>
    get(`${clanBase(tag)}/manage${refresh ? "?refresh=1" : ""}`),
  history: (tag) => get(`${clanBase(tag)}/history`),
  policy: (tag) => get(`${clanBase(tag)}/policy`),
  savePolicy: (tag, values, note) =>
    post(`${clanBase(tag)}/policy`, { values, note }),
  previewPolicy: (tag, values) =>
    post(`${clanBase(tag)}/policy/preview`, { values }),
  // Actions (2026-09-25): what waits for you, with each action's log.
  actions: (tag, refresh = false) =>
    get(`${clanBase(tag)}/actions${refresh ? "?refresh=1" : ""}`),
  decideAction: (tag, id, body) =>
    post(`${clanBase(tag)}/actions/${id}/decide`, body),
  commentAction: (tag, id, text) =>
    post(`${clanBase(tag)}/actions/${id}/comments`, { text }),
  setHold: (tag, playerTag, body) =>
    put(`${clanBase(tag)}/holds/${String(playerTag).replace(/^#/, "")}`, body),
  clearHold: (tag, playerTag) =>
    del(`${clanBase(tag)}/holds/${String(playerTag).replace(/^#/, "")}`),
  notes: (tag, playerTag) =>
    get(
      `${clanBase(tag)}/members/${String(playerTag).replace(/^#/, "")}/notes`,
    ),
  addNote: (tag, playerTag, text) =>
    post(
      `${clanBase(tag)}/members/${String(playerTag).replace(/^#/, "")}/notes`,
      { text },
    ),
  removeNote: (tag, noteId) => del(`${clanBase(tag)}/notes/${noteId}`),
  standing: (tag) => get(`${clanBase(tag)}/standing`),
  trophies: (tag) => get(`${clanBase(tag)}/trophies`),
  // "You here": the member's own numbers and place in this clan.
  memberView: (tag) => get(`${clanBase(tag)}/me`),
  scout: (tag, playerTag) => post(`${clanBase(tag)}/scout`, { tag: playerTag }),
  // Recruiting (2026-09-13): the pitch, the facts, the copy.
  recruit: (tag, refresh = false) =>
    get(`${clanBase(tag)}/recruit${refresh ? "?refresh=1" : ""}`),
  savePitch: (tag, values, note) =>
    post(`${clanBase(tag)}/recruit`, { values, note }),
  // The clan's own model (2026-09-25): its key, and a draft of the pitch.
  draftPitch: (tag, note) => post(`${clanBase(tag)}/recruit/draft`, { note }),
  model: (tag) => get(`${clanBase(tag)}/model`),
  setModelKey: (tag, key) => put(`${clanBase(tag)}/model`, { key }),
  chooseModel: (tag, model) => put(`${clanBase(tag)}/model`, { model }),
  removeModelKey: (tag) => del(`${clanBase(tag)}/model`),
  // What the clan shares with Elixir (door 3): one switch per fact type.
  sharing: (tag) => get(`${clanBase(tag)}/sharing`),
  saveSharing: (tag, values) => put(`${clanBase(tag)}/sharing`, { values }),
  // Away: the member's own word (2026-09-12).
  myAway: (tag) => get(`${clanBase(tag)}/me/away`),
  setAway: (tag, body) => put(`${clanBase(tag)}/me/away`, body),
  clearAway: (tag) => del(`${clanBase(tag)}/me/away`),
  // Awards (2026-09-12): the leader view, the document, grants by hand,
  // and a member's trophy case.
  awards: (tag, refresh = false) =>
    get(`${clanBase(tag)}/awards/manage${refresh ? "?refresh=1" : ""}`),
  saveAwards: (tag, values, note) =>
    post(`${clanBase(tag)}/awards/config`, { values, note }),
  grantAward: (tag, body) => post(`${clanBase(tag)}/awards/grants`, body),
  revokeAward: (tag, seasonId, awardId, playerTag) =>
    del(
      `${clanBase(tag)}/awards/grants/${seasonId}/${awardId}/${String(playerTag).replace(/^#/, "")}`,
    ),
  memberAwards: (tag, playerTag) =>
    get(
      `${clanBase(tag)}/members/${String(playerTag).replace(/^#/, "")}/grants`,
    ),
};

export const feedbackApi = {
  list: () => get("/api/feedback"),
  file: (body) => post("/api/feedback", body),
  item: (id) => get(`/api/feedback/${id}`),
  queue: () => get("/api/maintain/feedback"),
  decide: (id, body) => post(`/api/maintain/feedback/${id}`, body),
};

export const api = {
  me: (refresh = false) => get(refresh ? "/api/me?refresh=1" : "/api/me"),
  roster: (clanTag, refresh = false) => {
    const q = new URLSearchParams();
    if (clanTag) q.set("clan", clanTag);
    if (refresh) q.set("refresh", "1");
    const qs = q.toString();
    return get(qs ? `/api/roster?${qs}` : "/api/roster");
  },
  select: (clanTag) => post("/api/select", { clan_tag: clanTag }),
};
