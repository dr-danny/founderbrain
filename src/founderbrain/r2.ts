/**
 * src/founderbrain/r2.ts
 *
 * WHAT THIS IS. Presigned URLs for the private R2 media bucket (S3-compatible,
 * AWS Signature V4 in the query string, region "auto"). Browsers upload and view
 * through these short-lived URLs, so large files never pass through the API.
 *
 * WHY HAND-ROLLED. The signing is ~40 lines of node:crypto; pulling the S3 SDK
 * into the runtime image for four verbs is not worth the dependency surface.
 */
import { createHash, createHmac } from "node:crypto";

export type R2Config = {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
};

function rfc3986(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase(),
  );
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data, "utf8").digest();
}

/** Presign one request for `seconds`. Only the host header is signed; payload is unsigned. */
export function presignR2(
  config: R2Config,
  method: "GET" | "PUT" | "HEAD" | "DELETE",
  key: string,
  seconds: number,
  now = new Date(),
): string {
  return presignS3(config, method, key, seconds, now, "auto", "path");
}

/** Region and addressing are parameters only so the AWS published test vector can check the math. */
export function presignS3(
  config: R2Config,
  method: "GET" | "PUT" | "HEAD" | "DELETE",
  key: string,
  seconds: number,
  now: Date,
  region: string,
  style: "path" | "virtual",
): string {
  const endpoint = new URL(config.endpoint);
  const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const day = amzDate.slice(0, 8);
  const scope = `${day}/${region}/s3/aws4_request`;
  const objectPath = key.split("/").map(rfc3986).join("/");
  const path = style === "path" ? `/${rfc3986(config.bucket)}/${objectPath}` : `/${objectPath}`;
  const query: Array<[string, string]> = [
    ["X-Amz-Algorithm", "AWS4-HMAC-SHA256"],
    ["X-Amz-Credential", `${config.accessKeyId}/${scope}`],
    ["X-Amz-Date", amzDate],
    ["X-Amz-Expires", String(Math.max(1, Math.min(604_800, Math.floor(seconds))))],
    ["X-Amz-SignedHeaders", "host"],
  ];
  const canonicalQuery = query
    .map(([k, v]) => [rfc3986(k), rfc3986(v)] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  const canonicalRequest = [
    method,
    path,
    canonicalQuery,
    `host:${endpoint.host}\n`,
    "host",
    "UNSIGNED-PAYLOAD",
  ].join("\n");
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    scope,
    createHash("sha256").update(canonicalRequest, "utf8").digest("hex"),
  ].join("\n");
  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${config.secretAccessKey}`, day), region), "s3"),
    "aws4_request",
  );
  const signature = createHmac("sha256", signingKey).update(stringToSign, "utf8").digest("hex");
  return `${endpoint.origin}${path}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}
