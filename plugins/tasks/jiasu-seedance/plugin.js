export const meta = {
  apiVersion: 1,
  key: "jiasu-seedance",
  name: "JiaSu Seedance",
  description: { en: "JiaSu Seedance video generation", zh: "加速 Seedance 视频生成" },
  version: "1.0.0",
  author: { name: "QuantumNous" },
  baseUrl: "https://ai.jiasuapi.com",
  models: ["seedance-2.5-101010"],
  fetchMode: "per_task",
  usageSchema: {
    seconds: { type: "number", unit: "second", description: { en: "Video generation unit price", zh: "视频生成单价" } },
  },
  routes: [
    { method: "POST", path: "/v1/video/generations", type: "submit", decode: "createTask", render: "taskCreated" },
    { method: "GET", path: "/v1/videos/tasks/:task_id", type: "query", render: "taskStatus" },
  ],
  protocols: ["openai_video"],
};

function duration(body) {
  const value = Number(body.duration ?? body.seconds ?? 0);
  if (!Number.isFinite(value) || value <= 0) return 5;
  return Math.min(value, 3600);
}

function normalizeImages(images) {
  if (!Array.isArray(images)) return images;
  return images.map(function (image) {
    if (!image || typeof image !== "object" || Array.isArray(image)) return image;
    const copy = Object.assign({}, image);
    if (copy.type === "last_frame") copy.type = "end_frame";
    if (copy.type && copy.type !== "first_frame" && copy.type !== "end_frame") throw new Error("invalid images[].type: " + copy.type);
    return copy;
  });
}

function validate(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("request body must be an object");
  if (typeof body.model !== "string" || !body.model.trim()) throw new Error("model field is required");
  if (typeof body.prompt !== "string" || !body.prompt.trim()) throw new Error("prompt is required");
  for (const field of ["first_frame_url", "end_frame_url", "start_frame", "end_frame", "function_mode"])
    if (Object.prototype.hasOwnProperty.call(body, field)) throw new Error("field " + field + " is not supported; use images[].type first_frame/end_frame instead");
  const images = normalizeImages(body.images);
  if (Array.isArray(images) && images.some(function (image) { return image && (image.type === "first_frame" || image.type === "end_frame"); })) {
    if (Array.isArray(body.audios) && body.audios.length) throw new Error("audios cannot be used together with first_frame/end_frame image types");
  }
  const request = Object.assign({}, body, { model: body.model.trim(), duration: duration(body) });
  if (images !== undefined) request.images = images;
  return request;
}

export function buildSubmitRequest(ctx) {
  const body = Object.assign({}, ctx.requestBody || {});
  body.model = ctx.upstreamModel || ctx.model;
  body.images = normalizeImages(body.images);
  return { url: ctx.baseUrl + "/v1/video/generations", method: "POST", headers: { Authorization: "Bearer " + ctx.apiKey, "Content-Type": "application/json", Accept: "application/json" }, body };
}

export function parseSubmitResponse(ctx, response) {
  const body = response.body || {};
  const taskId = body.id || body.task_id;
  if (!taskId) throw new Error("task_id is empty");
  return { taskId: taskId, taskData: body };
}

export function extractUsage(ctx) { return { seconds: duration(ctx.requestBody || {}) }; }

export function buildQueryRequest(ctx) {
  return { url: ctx.baseUrl + "/v1/videos/tasks/" + encodeURIComponent(ctx.taskId), method: "GET", headers: { Authorization: "Bearer " + ctx.apiKey, Accept: "application/json" } };
}

export function parseTaskResult(ctx, body) {
  const statuses = { queued: "QUEUED", pending: "QUEUED", processing: "IN_PROGRESS", in_progress: "IN_PROGRESS", completed: "SUCCESS", failed: "FAILURE", cancelled: "FAILURE" };
  const status = statuses[body.status] || "UNKNOWN";
  const result = { status: status };
  if (status === "UNKNOWN") result.reason = "unrecognized status: " + String(body.status || "");
  if (status === "FAILURE") result.reason = body.error && body.error.message ? body.error.message : "task failed";
  if (body.progress > 0) result.progress = body.progress + "%";
  if (status === "SUCCESS" && Array.isArray(body.result_urls) && body.result_urls.length) result.artifacts = { video: { url: body.result_urls[0], type: "video" } };
  return result;
}

export function listArtifacts(task) {
  return task.status === "SUCCESS" ? [{ key: "video", type: "video" }] : [];
}

function artifactVideoURL(ctx) {
  const data = ctx && ctx.data ? ctx.data : {};
  if (Array.isArray(data.result_urls) && data.result_urls.length) return String(data.result_urls[0] || "").trim();
  if (data.video && data.video.url) return String(data.video.url || "").trim();
  return "";
}

export function buildContentRequest(ctx) {
  if (ctx.artifactKey !== "video") throw new Error("artifact_not_found");
  const url = artifactVideoURL(ctx);
  if (!url) throw new Error("artifact_not_found");
  return { url: url, method: ctx.clientRequest.method, credentialless: true };
}

export function renderTask(ctx, task) {
  return task.data || {};
}

export const protocols = {
  openai_video: {
    decodeRequest: function (ctx) {
      if (!ctx.body || ctx.body.kind !== "json") throw new Error("JSON body required");
      const request = validate(ctx.body.value);
      return { kind: "submit", model: request.model, requestBody: request };
    },
    render: function (ctx, task) { return task.data || {}; },
  },
};

export const native = { createTask: function (ctx) { return protocols.openai_video.decodeRequest(ctx); }, taskCreated: function (ctx, task) { return task.data || {}; }, taskStatus: renderTask };
